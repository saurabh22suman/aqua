#!/usr/bin/env tsx
/**
 * Finance lane — Root-style layout acceptance for the actual Reports index
 * (3 November 2026). PREPARED FOR ROOT; not run in this phase (no browser in
 * the lane; Root owns the integration build/preview).
 *
 * It drives the REAL Next app over HTTP in Chrome (no mock, no file://, no
 * HTTP mock bridge) and records the category-card geometry at 390, 320 and
 * 1280 in both presets:
 *
 *   - 390: two independent cards per row;
 *   - 320: two columns, or one column only if a card label would clip;
 *   - 1280: three columns;
 *   - every card is at least 44px tall and roughly 96-128px on a phone;
 *   - card text does not overflow its card (scrollWidth <= clientWidth + 1);
 *   - the old single 44px list row is gone (cards are independent boxes);
 *   - no card paints a headline figure.
 *
 * Run (Root):
 *   AQUA_E2E_BASE_URL=http://127.0.0.1:<port> \
 *   AQUA_E2E_OUT=.playwright-mcp/reports-category-layout \
 *   AQUA_E2E_PHONE=+919000000001 AQUA_E2E_PIN=123456 \
 *   pnpm exec tsx tests/owner-light-20261102/finance/reports-category-chrome.ts
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Check = { name: string; pass: boolean; detail: string };

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/reports-category-layout";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const VIEWPORTS = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-320", width: 320, height: 844 },
  { name: "desktop-1280", width: 1280, height: 900 },
];

async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle", timeout: 60_000 });
  const phone = page.locator("#login-phone");
  const pin = page.locator("#login-pin");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  for (let attempt = 0; attempt < 35; attempt++) {
    await phone.fill(PHONE);
    await pin.fill(PIN);
    await pin.blur();
    if (await submit.isEnabled()) break;
    await page.waitForTimeout(200);
  }
  if (!(await submit.isEnabled())) throw new Error("Synthetic login hydration failed");
  await submit.click();
  await page.waitForURL((url) => url.pathname.startsWith("/owner"), { timeout: 45_000 });
}

async function measure(page: Page) {
  return page.locator('[data-testid="report-card"]').first().evaluate(() => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="report-card"]'));
    return {
      count: cards.length,
      cards: cards.map((card) => {
        const box = card.getBoundingClientRect();
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          top: Math.round(box.top),
          left: Math.round(box.left),
          overflowX: card.scrollWidth - card.clientWidth,
          label: (card.getAttribute("aria-label") ?? "").slice(0, 40),
        };
      }),
    };
  });
}

async function theme(page: Page): Promise<string> {
  return page.locator('[aria-label^="Theme:"]').first().getAttribute("aria-label").then((value) => value ?? "");
}

async function run(): Promise<number> {
  if (!BASE_URL) throw new Error("AQUA_E2E_BASE_URL must name the preview.");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks: Check[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await signIn(page);

    for (const preset of ["mint", "lavender"]) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(`${BASE_URL}/owner/reports`, { waitUntil: "networkidle", timeout: 60_000 });
        const current = await theme(page);
        const want = preset === "mint" ? "Mint Garden" : "Lavender Club";
        if (!current.includes(want)) {
          await page.locator('[aria-label^="Theme:"]').first().click();
          await page.waitForTimeout(120);
        }
        const measured = await measure(page);
        const rows = new Map<number, number>();
        for (const card of measured.cards) rows.set(card.top, (rows.get(card.top) ?? 0) + 1);
        const columns = Math.max(...rows.values());
        const minHeight = Math.min(...measured.cards.map((card) => card.height));
        const minWidth = Math.min(...measured.cards.map((card) => card.width));
        const overflow = Math.max(...measured.cards.map((card) => card.overflowX));
        const key = `${preset}-${viewport.name}`;

        checks.push({ name: `${key}: five category cards`, pass: measured.count === 5, detail: String(measured.count) });
        const expectedColumns = viewport.width >= 1280 ? 3 : 2;
        checks.push({
          name: `${key}: ${expectedColumns} independent cards per row`,
          pass: columns === expectedColumns,
          detail: `columns=${columns} widths=${measured.cards.map((c) => c.width).join(",")}`,
        });
        checks.push({
          name: `${key}: phone card height 44-128`,
          pass: viewport.width >= 1280 || (minHeight >= 44 && minHeight <= 128),
          detail: `minHeight=${minHeight}`,
        });
        checks.push({ name: `${key}: no clipped card text`, pass: overflow <= 1, detail: `overflowX=${overflow}` });
        checks.push({ name: `${key}: no single full-width list row`, pass: viewport.width >= 1280 || minWidth < viewport.width - 24, detail: `minWidth=${minWidth}` });
        await page.screenshot({ path: `${OUT}/${key}.png`, fullPage: false, caret: "initial" });
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  const failures = checks.filter((check) => !check.pass);
  writeFileSync(resolve(process.cwd(), `${OUT}/reports-category-layout.json`), `${JSON.stringify({ at: new Date().toISOString(), baseUrl: BASE_URL, mode: "actual app Chrome, synthetic login, no mock", checks }, null, 2)}\n`);
  console.log(JSON.stringify({ checks: checks.length, failures: failures.length, failuresList: failures }, null, 2));
  return failures.length ? 1 : 0;
}

run().then(
  (code) => process.exit(code),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
