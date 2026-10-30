import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Members Back/forward restoration — filters live only in this history entry's
// state. No q/status in the URL, no person payload, no storage.

const base = process.env.AQUA_E2E_BASE_URL;
const out = process.env.AQUA_E2E_OUT;
if (!base || !out) throw new Error("AQUA_E2E_BASE_URL/AQUA_E2E_OUT missing");
mkdirSync(out, { recursive: true });

type Report = { checks: Array<{ name: string; pass: boolean; detail?: unknown }>; failures: string[] };
const report: Report = { checks: [], failures: [] };
const check = (name: string, pass: boolean, detail?: unknown) => {
  report.checks.push({ name, pass, detail });
  if (!pass) report.failures.push(name);
};

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Mobile number").fill("9000000001");
  await page.getByLabel(/^PIN/i).fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 60_000 });

  async function openFirstMember() {
    await page.getByTestId("member-row").first().click();
    await page.waitForURL(/\/owner\/members\/[0-9a-f-]{36}/, { timeout: 20_000 });
  }

  // Narrow filter: URL stays clean, Back restores the same matching rows.
  await page.goto(`${base}/owner/members`, { waitUntil: "networkidle" });
  await page.getByTestId("members-search").fill("Member 02");
  await page.waitForTimeout(700);
  const narrow = await page.evaluate(() => ({
    url: `${location.pathname}${location.search}`,
    rows: Array.from(document.querySelectorAll('[data-testid="member-row"]')).map((r) => r.textContent ?? ""),
  }));
  check("search is not written into the URL", narrow.url === "/owner/members", narrow.url);
  check("filtered list settles to the matching row", narrow.rows.length >= 1 && narrow.rows.every((r) => r.includes("02")), narrow.rows);
  await openFirstMember();
  await page.goBack();
  await page.waitForURL(/\/owner\/members$/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const narrowBack = await page.evaluate(() => ({
    search: (document.querySelector('[data-testid="members-search"]') as HTMLInputElement | null)?.value ?? null,
    rows: Array.from(document.querySelectorAll('[data-testid="member-row-name"]')).map((r) => r.textContent ?? ""),
    url: `${location.pathname}${location.search}`,
    history: window.history.state,
  }));
  check("Back restores the filter state", narrowBack.search === "Member 02", narrowBack.search);
  check("Back fetches authoritative matching rows", narrowBack.rows.length === 1 && narrowBack.rows[0]?.includes("02"), narrowBack);
  check("Back leaves the URL clean", narrowBack.url === "/owner/members", narrowBack.url);

  // Broad filter + scroll: restore only after the fetched rows/layout are ready.
  await page.getByTestId("members-search").fill("e");
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => {
    window.scrollTo(0, 1100);
    return { actual: window.scrollY };
  });
  await page.waitForTimeout(150);
  check("broad list scrolls before opening", before.actual > 0, before);
  // Click without Playwright scrolling the first row back to the top.
  await page.getByTestId("member-row").first().evaluate((el) => (el as HTMLElement).click());
  await page.waitForURL(/\/owner\/members\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await page.goBack();
  await page.waitForURL(/\/owner\/members$/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  const restored = await page.evaluate(() => ({
    search: (document.querySelector('[data-testid="members-search"]') as HTMLInputElement | null)?.value ?? null,
    scroll: window.scrollY,
    history: window.history.state,
  }));
  check("Back restores the broad filter", restored.search === "e", restored.search);
  check("Back restores scroll after rows are ready", Math.abs(restored.scroll - before.actual) <= 2, { before: before.actual, after: restored.scroll, history: restored.history });

  // Forward/back: the same list entry keeps its state.
  await page.goForward();
  await page.waitForURL(/\/owner\/members\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await page.goBack();
  await page.waitForURL(/\/owner\/members$/, { timeout: 20_000 });
  await page.waitForTimeout(700);
  const again = await page.evaluate(() => ({
    search: (document.querySelector('[data-testid="members-search"]') as HTMLInputElement | null)?.value ?? null,
    scroll: window.scrollY,
  }));
  check("second Back restores filter and scroll", again.search === "e" && Math.abs(again.scroll - before.actual) <= 2, { again, before: before.actual });

  // Malformed/foreign namespace state must be discarded, not used.
  await page.evaluate(() => {
    history.replaceState({ ownerMembersList: { key: "other-tenant", search: "secret", scrollY: 9999 } }, "", location.href);
  });
  await openFirstMember();
  await page.goBack();
  await page.waitForURL(/\/owner\/members$/, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const malformed = await page.evaluate(() => ({
    search: (document.querySelector('[data-testid="members-search"]') as HTMLInputElement | null)?.value ?? null,
    scroll: window.scrollY,
  }));
  check("foreign/malformed history state is ignored", malformed.search !== "secret" && malformed.scroll !== 9999, malformed);

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
