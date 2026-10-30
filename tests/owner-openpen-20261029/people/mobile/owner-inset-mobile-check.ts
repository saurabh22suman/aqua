import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// People mobile slice — intended rendered RED before adopting the transferred
// OwnerPage/PageHeader foundation. The check measures the actual content inset,
// heading rhythm and 320–430px reflow; it does not assert utility classes.

const base = process.env.AQUA_E2E_BASE_URL;
const out = process.env.AQUA_E2E_OUT;
if (!base || !out) throw new Error("AQUA_E2E_BASE_URL/AQUA_E2E_OUT missing");
mkdirSync(out, { recursive: true });

type Report = {
  checks: Array<{ name: string; pass: boolean; detail?: unknown }>;
  failures: string[];
};
const report: Report = { checks: [], failures: [] };
function check(name: string, pass: boolean, detail?: unknown) {
  report.checks.push({ name, pass, detail });
  if (!pass) report.failures.push(name);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Mobile number").fill("9000000001");
  await page.getByLabel(/^PIN/i).fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 60_000 });

  async function open(path: string, width = 390, height = 844) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    return page.evaluate(() => {
      const owner = document.querySelector("[data-owner-page]");
      const h1 = document.querySelector("h1");
      const purpose = h1?.parentElement?.querySelector("p");
      return {
        ownerPage: !!owner,
        inset: owner ? parseFloat(getComputedStyle(owner).paddingLeft) : null,
        h1Size: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
        purposeSize: purpose ? parseFloat(getComputedStyle(purpose).fontSize) : null,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
  }

  await open("/owner/members", 390, 844);
  const detailHref = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="member-row"]');
    return row?.getAttribute("href") ?? null;
  });
  if (!detailHref) throw new Error("member detail link missing");
  const routes = [
    "/owner/members",
    "/owner/members/new",
    "/owner/members/import",
    "/owner/fees?tab=dues",
    `${detailHref}/edit`,
    `${detailHref}?tab=payments`,
  ];
  for (const route of routes) {
    const before = await open(route, 390, 844);
    check(`${route} phone uses OwnerPage`, before.ownerPage);
    check(`${route} phone inset is 16px`, before.inset === 16, before.inset);
    check(`${route} phone h1 is 22px`, before.h1Size === 22, before.h1Size);
    check(`${route} phone purpose is 13px`, before.purposeSize === 13, before.purposeSize);
  }

  for (const width of [320, 360, 390, 430]) {
    for (const route of routes) {
      const metrics = await open(route, width, 844);
      check(`${route} ${width}px no horizontal overflow`, metrics.overflow <= 0, metrics.overflow);
    }
  }

  await open("/owner/fees?tab=dues", 390, 844);
  const mobileTable = await page.getByRole("table", { name: "Outstanding invoices" }).count();
  const mobileRows = await page.getByRole("row").count();
  check("dues keeps a named table role on the phone", mobileTable === 1, mobileTable);
  check("dues keeps programmatic rows on the phone", mobileRows > 0, mobileRows);

  await open("/owner/members", 1280, 900);
  const desktop = await page.evaluate(() => {
    const owner = document.querySelector("[data-owner-page]");
    const h1 = document.querySelector("h1");
    return {
      inset: owner ? parseFloat(getComputedStyle(owner).paddingLeft) : null,
      h1Size: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
    };
  });
  check("desktop uses OwnerPage 28px inset", desktop.inset === 28, desktop.inset);
  check("desktop h1 is 22px", desktop.h1Size === 22, desktop.h1Size);

  // Long action + complete editor reachability on the narrow phone.
  await open("/owner/members", 320, 844);
  const membersActions = await page.evaluate(() => {
    const add = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Add"));
    const imp = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes("Import"));
    return { add: !!add, import: !!imp, overflow: document.documentElement.scrollWidth - window.innerWidth };
  });
  check("members long actions stay reachable at 320px", membersActions.add && membersActions.import);
  check("members long actions do not overflow at 320px", membersActions.overflow <= 0, membersActions.overflow);

  await open("/owner/members/new", 320, 844);
  const create = await page.evaluate(() => {
    const submit = document.querySelector('[data-testid="submit-member"]');
    const cancel = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.trim() === "Cancel");
    submit?.scrollIntoView({ block: "center" });
    return {
      submit: !!submit,
      cancel: !!cancel,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  check("create keeps Cancel/Save in flow at 320px", create.submit && create.cancel);
  check("create has no horizontal overflow at 320px", create.overflow <= 0, create.overflow);
  const lastField = page.locator("#member-medical-notes-field");
  await lastField.scrollIntoViewIfNeeded();
  check("create last field is reachable at 320px", await lastField.isVisible());
  await page.getByTestId("submit-member").scrollIntoViewIfNeeded();
  const saveVisible = await page.getByTestId("submit-member").isVisible();
  check("create Save is reachable after scroll", saveVisible);

  await open(`${detailHref}/edit`, 320, 844);
  const editLast = page.locator("#edit-medical-notes-field");
  await editLast.scrollIntoViewIfNeeded();
  check("edit last field is reachable at 320px", await editLast.isVisible());
  await page.getByRole("button", { name: "Save changes" }).scrollIntoViewIfNeeded();
  check("edit Save is reachable at 320px", await page.getByRole("button", { name: "Save changes" }).isVisible());
  check("edit Cancel is present at 320px", await page.getByRole("link", { name: "Cancel" }).isVisible());

  await open(`${detailHref}?tab=payments`, 320, 844);
  await page.waitForSelector('[data-testid="member-invoice-due"]', { timeout: 10_000 });
  const paymentEvidence = await page.evaluate(() => document.body.textContent ?? "");
  check("payment row keeps due, balance and state on phone", paymentEvidence.includes("Due ") && paymentEvidence.includes("Balance ") && paymentEvidence.includes("Partially paid"));

  await open("/owner/members/import", 320, 844);
  check("import file control is reachable at 320px", await page.locator("#member-import-file").isVisible());
  check("import template link is reachable at 320px", await page.getByRole("link", { name: /CSV template/i }).isVisible());

  // Theme switch must not change the inset or reflow.
  await open("/owner/members", 390, 844);
  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(250);
  const themed = await page.evaluate(() => {
    const owner = document.querySelector("[data-owner-page]");
    return {
      inset: owner ? parseFloat(getComputedStyle(owner).paddingLeft) : null,
      theme: document.documentElement.dataset.theme,
    };
  });
  check("Lavender keeps the 16px phone inset", themed.inset === 16, themed.inset);
  for (const route of routes) {
    const metrics = await open(route, 390, 844);
    check(`Lavender ${route} keeps OwnerPage and reflow`, metrics.ownerPage && metrics.inset === 16 && metrics.overflow <= 0, metrics);
  }

  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length) process.exit(1);
} catch (error) {
  report.failures.push(String(error));
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
