#!/usr/bin/env tsx
/**
 * Owner OpenPen — scheduling lane rendered check.
 *
 * Proves the assigned routes render their composed arrangement in a
 * disposable preview: identity heading, named surfaces, the batch
 * table/queue, the calendar, the sessions editor and the booking
 * board + selected slot. It also reports actual horizontal overflow at
 * 1280×900 and 390×844. Geometry is read from the rendered DOM; no
 * class-string assertions.
 *
 * Run only through .opencode/scripts/owner_preview.py (bounded lease).
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/owner-scheduling";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

mkdirSync(OUT, { recursive: true });

type Finding = { viewport: string; route: string; problem: string };
const findings: Finding[] = [];
const notes: string[] = [];

function fail(viewport: string, route: string, problem: string) {
  findings.push({ viewport, route, problem });
}

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
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
  } finally {
    await page.close();
  }
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

async function contentInset(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const content = document.querySelector('[data-testid="owner-content"]');
    const main = document.querySelector("main");
    if (!content || !main) return null;
    const left = main.getBoundingClientRect().left - content.getBoundingClientRect().left;
    const padding = Number.parseFloat(getComputedStyle(main).paddingLeft) || 0;
    return Math.round(left + padding);
  });
}

async function expectHeading(page: Page, name: string | RegExp) {
  const heading = page.getByRole("heading", { name, level: 1 }).first();
  await heading.waitFor({ state: "visible", timeout: 30_000 });
}

async function visit(
  page: Page,
  viewport: string,
  route: string,
  check: () => Promise<void>,
) {
  await page.goto(`${BASE_URL}${route}`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  const bleed = await overflow(page);
  if (bleed > 1) fail(viewport, route, `page overflows horizontally by ${bleed}px`);
  const expectedInset = viewport.startsWith("phone") || viewport.startsWith("narrow")
    ? 16
    : 28;
  const inset = await contentInset(page);
  if (inset === null || Math.abs(inset - expectedInset) > 1) {
    fail(
      viewport,
      route,
      `content inset is ${inset ?? "missing"}px, expected ${expectedInset}px`,
    );
  }
  try {
    await check();
  } catch (error) {
    fail(viewport, route, (error as Error).message.slice(0, 300));
  }
}

const VIEWPORTS = [
  { name: "desktop-1280x900", width: 1280, height: 900 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-short-1280x600", width: 1280, height: 600 },
  { name: "phone-390x844", width: 390, height: 844 },
];

async function main() {
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await signIn(context);
      const page = await context.newPage();

      await visit(page, viewport.name, "/owner/programs", async () => {
        await expectHeading(page, "Programs & batches");
        if (viewport.width >= 768) {
          const table = page.getByRole("table").first();
          await table.waitFor({ state: "visible", timeout: 20_000 });
          const headers = await table
            .locator("thead th")
            .allTextContents();
          for (const wanted of ["Days", "Time", "Coach", "Places"]) {
            if (!headers.some((text) => text.includes(wanted))) {
              throw new Error(`batch table is missing the ${wanted} column`);
            }
          }
          const add = page.getByRole("button", { name: "Add program" });
          const addBox = await add.boundingBox();
          const tableBox = await table.boundingBox();
          if (!addBox || !tableBox || addBox.y > tableBox.y) {
            throw new Error("Add program is not above the batch catalogue");
          }
        } else {
          await page
            .getByTestId("batches-list-mobile")
            .waitFor({ state: "visible", timeout: 20_000 });
        }
      });
      await page.screenshot({
        path: join(OUT, `${viewport.name}-programs.png`),
        fullPage: false,
      });

      await visit(page, viewport.name, "/owner/schedule", async () => {
        await expectHeading(page, "Schedule");
        await page
          .getByRole("heading", { name: /scheduled sessions/i })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        if (viewport.width >= 768) {
          await page
            .getByTestId("calendar-grid")
            .first()
            .waitFor({ state: "visible", timeout: 20_000 });
        } else {
          const strip = page.getByTestId("calendar-day-strip");
          if (await strip.isVisible().catch(() => false)) {
            const chips = strip.locator("> *");
            const boxes = await Promise.all(
              Array.from({ length: await chips.count() }, (_, index) =>
                chips.nth(index).boundingBox(),
              ),
            );
            const rows = new Map<number, number>();
            for (const box of boxes) {
              if (!box) continue;
              const key = Math.round(box.y);
              rows.set(key, (rows.get(key) ?? 0) + 1);
            }
            if (Array.from(rows.values()).some((count) => count === 1)) {
              throw new Error("week day chooser leaves an orphan single-day row");
            }
          }
        }
        const agenda = page.locator('[data-testid="calendar-agenda"]:visible').first();
        const empty = page.getByTestId("calendar-empty").first();
        await Promise.race([
          agenda.waitFor({ state: "visible", timeout: 20_000 }),
          empty.waitFor({ state: "visible", timeout: 20_000 }),
        ]);
      });
      await page.screenshot({
        path: join(OUT, `${viewport.name}-schedule.png`),
        fullPage: false,
      });

      await visit(page, viewport.name, "/owner/sessions", async () => {
        await expectHeading(page, "Session exceptions");
        await page
          .getByRole("heading", { name: "Sessions needing management" })
          .waitFor({ state: "visible", timeout: 20_000 });
        const manage = page.getByRole("button", { name: "Manage" }).first();
        if (await manage.count()) {
          await manage.click();
          await page
            .getByRole("heading", { name: /Selected session ·/i })
            .waitFor({ state: "visible", timeout: 20_000 });
        } else {
          notes.push(`${viewport.name} /owner/sessions: no sessions in the window`);
        }
      });
      await page.screenshot({
        path: join(OUT, `${viewport.name}-sessions.png`),
        fullPage: false,
      });

      await visit(page, viewport.name, "/owner/bookings", async () => {
        await expectHeading(page, "Bookings");
        await page
          .getByRole("heading", { name: "Day board" })
          .waitFor({ state: "visible", timeout: 20_000 });
        await page
          .getByRole("heading", { name: "Selected slot" })
          .waitFor({ state: "visible", timeout: 20_000 });
        if (viewport.width < 430) {
          const managePrices = page.getByTestId("owner-bookings-manage-prices");
          if (await managePrices.count()) {
            const lines = await managePrices.evaluate(
              (element) => element.getClientRects().length,
            );
            if (lines > 1) {
              throw new Error(`booking price link wraps across ${lines} lines`);
            }
          }
        }
        const summary = page.getByTestId("booking-slot-summary");
        if (!(await summary.count())) {
          throw new Error("selected slot has no visible date/slot/duration/zone summary");
        }
        const summaryText = (await summary.textContent()) ?? "";
        for (const wanted of ["Asia/Kolkata", "1 hour"]) {
          if (!summaryText.includes(wanted)) {
            throw new Error(`selected-slot summary is missing ${wanted}`);
          }
        }
        if (viewport.width >= 1024) {
          const board = await page
            .getByRole("heading", { name: "Day board" })
            .boundingBox();
          const selected = await page
            .getByRole("heading", { name: "Selected slot" })
            .boundingBox();
          if (!board || !selected || selected.x <= board.x) {
            throw new Error(
              "Selected slot is not composed beside the day board at this desktop width",
            );
          }
          const dateField = await page.getByTestId("booking-date").boundingBox();
          if (!dateField || dateField.width < 180) {
            throw new Error(
              `booking date field is too narrow in the selected slot (${dateField?.width ?? 0}px)`,
            );
          }
        }
        await page.getByRole("tab", { name: "Board" }).click();
        const choice = page.getByRole("button", { name: "Choose slot" }).first();
        await choice.waitFor({ state: "visible", timeout: 20_000 });
        const slot = page.getByTestId("booking-slot");
        const before = await slot.inputValue();
        await choice.click();
        const after = await slot.inputValue();
        if (before === after) {
          throw new Error("Choose slot did not move the selected hour");
        }
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const confirm = page.getByTestId("booking-create");
        await confirm.scrollIntoViewIfNeeded();
        const nav = page.getByTestId("owner-mobile-nav");
        if (await nav.isVisible().catch(() => false)) {
          const control = await confirm.boundingBox();
          const bar = await nav.boundingBox();
          if (control && bar && control.y + control.height > bar.y + 1) {
            throw new Error("booking confirm control is covered by the mobile nav");
          }
        }
      });
      await page.screenshot({
        path: join(OUT, `${viewport.name}-bookings.png`),
        fullPage: false,
      });

      await visit(page, viewport.name, "/owner/onboarding", async () => {
        await expectHeading(page, "Set up your first register");
        await page
          .getByText(/of 3 checks complete/)
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
      });
      await page.screenshot({
        path: join(OUT, `${viewport.name}-onboarding.png`),
        fullPage: false,
      });

      await context.close();
    }

    // Representative narrow/landscape family for the scheduling
    // surfaces that carry the most horizontal content. Not a Cartesian
    // sweep: the routes and widths the review named as risk points.
    const NARROW = [
      { name: "narrow-320x640", width: 320, height: 640 },
      { name: "narrow-360x780", width: 360, height: 780 },
      { name: "narrow-430x932", width: 430, height: 932 },
      { name: "narrow-640x360", width: 640, height: 360 },
    ];
    for (const narrow of NARROW) {
      const context = await browser.newContext({
        viewport: { width: narrow.width, height: narrow.height },
      });
      await signIn(context);
      const page = await context.newPage();
      for (const route of ["/owner/schedule", "/owner/bookings", "/owner/sessions"]) {
        await page.goto(`${BASE_URL}${route}`, {
          waitUntil: "networkidle",
          timeout: 120_000,
        });
        const bleed = await overflow(page);
        if (bleed > 1) {
          fail(narrow.name, route, `page overflows horizontally by ${bleed}px`);
        }
        const inset = await contentInset(page);
        if (inset === null || Math.abs(inset - 16) > 1) {
          fail(narrow.name, route, `content inset is ${inset ?? "missing"}px, expected 16px`);
        }
        const heading = page.getByRole("heading", { level: 1 }).first();
        if (!(await heading.isVisible().catch(() => false))) {
          fail(narrow.name, route, "page heading is not visible");
        }
        if (route === "/owner/schedule") {
          const item = page.locator('[data-testid="calendar-agenda-item"]:visible').first();
          if (await item.count()) {
            const clippedAgenda = await page.evaluate(() =>
              Array.from(
                document.querySelectorAll('[data-testid="calendar-agenda-item"] span'),
              ).some((element) => element.scrollWidth > element.clientWidth + 1),
            );
            if (clippedAgenda) {
              fail(narrow.name, route, "agenda text is clipped instead of wrapping");
            }
            await item.click();
            const detail = page.getByTestId("calendar-detail");
            await detail.waitFor({ state: "visible", timeout: 20_000 });
            const clipped = await detail.evaluate((element) =>
              Array.from(element.querySelectorAll("dd")).some(
                (value) => value.scrollWidth > value.clientWidth + 1,
              ),
            );
            if (clipped) {
              fail(narrow.name, route, "event detail value is clipped");
            }
            const box = await detail.boundingBox();
            if (box && box.width > narrow.width - 8) {
              fail(narrow.name, route, `event detail is wider than the viewport (${Math.round(box.width)}px)`);
            }
            await page.keyboard.press("Escape");
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: join(OUT, `${narrow.name}-${route.split("/").pop()}.png`),
          fullPage: false,
        });
      }
      await context.close();
    }

    // Both owner presets must carry the same composition. The theme
    // control is a shell primitive; this lane only proves its own
    // routes survive the swap without overflow or a missing surface.
    const lavender = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await signIn(lavender);
    const lavenderPage = await lavender.newPage();
    await lavenderPage.goto(`${BASE_URL}/owner/programs`, { waitUntil: "networkidle" });
    await lavenderPage.getByTestId("theme-toggle").click();
    const theme = await lavenderPage.evaluate(
      () => document.documentElement.dataset.theme,
    );
    if (theme !== "lavender") {
      fail("desktop-1280x900", "/owner/programs", `theme did not switch (${theme})`);
    }
    for (const route of [
      "/owner/programs",
      "/owner/schedule",
      "/owner/sessions",
      "/owner/bookings",
      "/owner/onboarding",
    ]) {
      await lavenderPage.goto(`${BASE_URL}${route}`, {
        waitUntil: "networkidle",
        timeout: 120_000,
      });
      const bleed = await overflow(lavenderPage);
      if (bleed > 1) {
        fail("lavender-1280x900", route, `page overflows horizontally by ${bleed}px`);
      }
      const heading = lavenderPage.getByRole("heading", { level: 1 }).first();
      if (!(await heading.isVisible().catch(() => false))) {
        fail("lavender-1280x900", route, "page heading is not visible");
      }
      await lavenderPage.screenshot({
        path: join(OUT, `lavender-1280x900-${route.split("/").pop()}.png`),
        fullPage: false,
      });
    }
    await lavender.close();

    // Lavender must hold at the phone width as well as desktop.
    const lavenderPhone = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await signIn(lavenderPhone);
    const lavenderPhonePage = await lavenderPhone.newPage();
    await lavenderPhonePage.goto(`${BASE_URL}/owner/programs`, {
      waitUntil: "networkidle",
    });
    await lavenderPhonePage.getByTestId("theme-toggle").click();
    const phoneTheme = await lavenderPhonePage.evaluate(
      () => document.documentElement.dataset.theme,
    );
    if (phoneTheme !== "lavender") {
      fail("lavender-390x844", "/owner/programs", `theme did not switch (${phoneTheme})`);
    }
    for (const route of [
      "/owner/programs",
      "/owner/schedule",
      "/owner/sessions",
      "/owner/bookings",
      "/owner/onboarding",
    ]) {
      await lavenderPhonePage.goto(`${BASE_URL}${route}`, {
        waitUntil: "networkidle",
        timeout: 120_000,
      });
      const bleed = await overflow(lavenderPhonePage);
      if (bleed > 1) {
        fail("lavender-390x844", route, `page overflows horizontally by ${bleed}px`);
      }
      const heading = lavenderPhonePage.getByRole("heading", { level: 1 }).first();
      if (!(await heading.isVisible().catch(() => false))) {
        fail("lavender-390x844", route, "page heading is not visible");
      }
      await lavenderPhonePage.screenshot({
        path: join(OUT, `lavender-390x844-${route.split("/").pop()}.png`),
        fullPage: false,
      });
    }
    await lavenderPhonePage.goto(`${BASE_URL}/owner/programs`, {
      waitUntil: "networkidle",
    });
    const phoneBatch = lavenderPhonePage.getByRole("link", { name: "Open" }).first();
    if (await phoneBatch.count()) {
      await phoneBatch.click();
      await lavenderPhonePage.waitForURL(/\/owner\/batches\//, { timeout: 30_000 });
      await lavenderPhonePage.waitForLoadState("networkidle");
      const route = new URL(lavenderPhonePage.url()).pathname;
      const bleed = await overflow(lavenderPhonePage);
      if (bleed > 1) {
        fail("lavender-390x844", route, `page overflows horizontally by ${bleed}px`);
      }
      await lavenderPhonePage.screenshot({
        path: join(OUT, "lavender-390x844-batch.png"),
        fullPage: false,
      });
    }
    await lavenderPhone.close();

    // One batch detail route: the first batch the catalogue offers.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await signIn(context);
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/owner/programs`, { waitUntil: "networkidle" });
    const open = page
      .locator("table")
      .getByRole("link", { name: "Open" })
      .first();
    if (await open.count()) {
      await open.click();
      await page.waitForURL(/\/owner\/batches\//, { timeout: 30_000 });
      await page.waitForLoadState("networkidle");
      const route = new URL(page.url()).pathname;
      const bleed = await overflow(page);
      if (bleed > 1) {
        fail("desktop-1280x900", route, `page overflows horizontally by ${bleed}px`);
      }
      try {
        await expectHeading(page, /.+/);
        await page
          .getByRole("heading", { name: /attendance/i })
          .first()
          .waitFor({ state: "visible", timeout: 20_000 });
        await page
          .getByRole("heading", { name: "Waitlist in order" })
          .waitFor({ state: "visible", timeout: 20_000 });
      } catch (error) {
        fail("desktop-1280x900", route, (error as Error).message.slice(0, 300));
      }
      await page.screenshot({
        path: join(OUT, "desktop-1280x900-batch.png"),
        fullPage: false,
      });
    } else {
      notes.push("no batch link on /owner/programs; batch detail not visited");
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const report = { baseUrl: BASE_URL, findings, notes };
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (findings.length > 0) process.exitCode = 1;
}

await main();
