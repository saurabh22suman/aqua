#!/usr/bin/env tsx
/**
 * Owner Settings — booking prices rendered flow.
 *
 * Verifies the reference task flow in a disposable preview: the existing
 * catalogue leads, one editor opens on demand, the refusal meaning and
 * booking-desk link are visible, and the catalogue remains readable at
 * 390px in both themes. Creates one synthetic price rule in the
 * disposable DB; no product/action changes.
 *
 * Run only through .opencode/scripts/owner_preview.py.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/booking-prices";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
mkdirSync(OUT, { recursive: true });

const findings: Array<{ viewport: string; problem: string }> = [];
function fail(viewport: string, problem: string) {
  findings.push({ viewport, problem });
}

async function signIn(page: Page) {
  await page.goto(`${BASE_URL}/login`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  const submit = page.locator("form button[type=submit]");
  let enabled = false;
  for (let attempt = 0; attempt < 8 && !enabled; attempt++) {
    await page.fill("#login-phone", PHONE);
    await page.fill("#login-pin", PIN);
    await page.locator("#login-pin").blur();
    enabled = await page.evaluate(() => {
      const button = document.querySelector(
        'form button[type="submit"]',
      ) as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    if (!enabled) await page.waitForTimeout(750);
  }
  if (!enabled) throw new Error("sign-in never became enabled");
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 45_000,
    }),
    submit.click(),
  ]);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

async function main() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await signIn(page);
    await page.goto(`${BASE_URL}/owner/settings/booking-prices`, {
      waitUntil: "networkidle",
      timeout: 120_000,
    });

    if (!(await page.getByRole("heading", { level: 1 }).first().isVisible())) {
      fail("desktop-1280x900", "page heading is not visible");
    }

    // Empty catalogue opens the editor directly. Create one real rule.
    let label = page.getByTestId("price-rule-label");
    if (!(await label.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Add price rule" }).click();
      label = page.getByTestId("price-rule-label");
      await label.waitFor({ state: "visible", timeout: 20_000 });
    }
    const facilityControl = await page.getByTestId("price-rule-facility").boundingBox();
    const priceControl = await page.getByTestId("price-rule-price").boundingBox();
    if (
      !facilityControl ||
      !priceControl ||
      Math.abs(facilityControl.y - priceControl.y) > 1
    ) {
      fail(
        "desktop-1280x900",
        `Facility/Price control baselines differ (${Math.round(facilityControl?.y ?? -1)} vs ${Math.round(priceControl?.y ?? -1)})`,
      );
    }
    await label.fill("Evening court");
    await page.getByTestId("price-rule-price").fill("500");
    await page.getByTestId("price-rule-save").click();
    const row = page
      .getByTestId("price-rule-row")
      .filter({ hasText: "Evening court" })
      .first();
    await row.waitFor({ state: "visible", timeout: 30_000 });
    const rowText = (await row.textContent()) ?? "";
    for (const wanted of ["Evening court", "₹500"]) {
      if (!rowText.includes(wanted)) fail("desktop-1280x900", `catalogue row missing ${wanted}`);
    }
    await page
      .getByTestId("price-rule-label")
      .waitFor({ state: "detached", timeout: 20_000 })
      .catch(() => fail("desktop-1280x900", "editor stayed open after save"));
    const add = page.getByRole("button", { name: "Add price rule" });
    if (!(await add.isVisible().catch(() => false))) {
      fail("desktop-1280x900", "Add price rule is not visible after save");
    }
    const notice = await page.getByText(/existing bookings retain their quoted price/).count();
    if (!notice) fail("desktop-1280x900", "refusal meaning is missing");
    const desk = page.getByRole("link", { name: "Open booking desk" });
    if ((await desk.getAttribute("href")) !== "/owner/bookings") {
      fail("desktop-1280x900", "booking desk link is missing or wrong");
    }
    const columnYs: number[] = [];
    for (const column of ["Rule", "Facility", "Applies", "Price"]) {
      const heading = page.getByText(column, { exact: true }).first();
      if (!(await heading.count())) {
        fail("desktop-1280x900", `catalogue column ${column} is missing`);
        continue;
      }
      const box = await heading.boundingBox();
      if (box) columnYs.push(box.y);
    }
    if (columnYs.length && Math.max(...columnYs) - Math.min(...columnYs) > 2) {
      fail("desktop-1280x900", "catalogue column labels are not on one row");
    }

    // One bounded editor on demand.
    await page.getByTestId("price-rule-edit").first().click();
    const editLabel = page.getByTestId("price-rule-label");
    await editLabel.waitFor({ state: "visible", timeout: 20_000 });
    if ((await editLabel.inputValue()) !== "Evening court") {
      fail("desktop-1280x900", "edit did not prefill the rule");
    }
    await page.getByRole("button", { name: "Cancel" }).click();
    if (await page.getByTestId("price-rule-label").count()) {
      fail("desktop-1280x900", "Cancel did not close the editor");
    }

    await page.screenshot({
      path: join(OUT, "desktop-1280x900-booking-prices.png"),
      fullPage: false,
    });

    await page.getByTestId("theme-toggle").click();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    if (theme !== "lavender") fail("lavender-1280x900", `theme did not switch (${theme})`);
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByTestId("price-rule-row")
      .filter({ hasText: "Evening court" })
      .first()
      .waitFor({ state: "visible" });
    await page.screenshot({
      path: join(OUT, "lavender-1280x900-booking-prices.png"),
      fullPage: false,
    });

    // Phone width, both themes; the same rule persists in the disposable DB.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    const bleed = await overflow(page);
    if (bleed > 1) fail("phone-390x844", `page overflows horizontally by ${bleed}px`);
    if (
      !(await page
        .getByTestId("price-rule-row")
        .filter({ hasText: "Evening court" })
        .first()
        .isVisible())
    ) {
      fail("phone-390x844", "catalogue row is not visible");
    }
    if (!(await page.getByRole("button", { name: "Add price rule" }).isVisible())) {
      fail("phone-390x844", "Add price rule is not visible");
    }
    await page.screenshot({
      path: join(OUT, "lavender-390x844-booking-prices.png"),
      fullPage: false,
    });
    await page.getByTestId("theme-toggle").click();
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByTestId("price-rule-row")
      .filter({ hasText: "Evening court" })
      .first()
      .waitFor({ state: "visible" });
    const mintBleed = await overflow(page);
    if (mintBleed > 1) fail("mint-390x844", `page overflows horizontally by ${mintBleed}px`);
    await page.screenshot({
      path: join(OUT, "mint-390x844-booking-prices.png"),
      fullPage: false,
    });

    await context.close();
  } finally {
    await browser.close();
  }

  writeFileSync(join(OUT, "report.json"), JSON.stringify({ findings }, null, 2));
  console.log(JSON.stringify({ findings }, null, 2));
  if (findings.length > 0) process.exitCode = 1;
}

await main();
