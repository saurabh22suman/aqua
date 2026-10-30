import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Members list restoration — search/status URL state + scroll after returning
// from a member. This is an actual browser probe, not a class snapshot.

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Mobile number").fill("9000000001");
  await page.getByLabel(/^PIN/i).fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 60_000 });

  async function run(label: string) {
    await page.goto(`${base}/owner/members`, { waitUntil: "networkidle" });
    const search = page.getByTestId("members-search");
    await search.fill("e");
    await page.waitForTimeout(700);

    const typedUrl = await page.evaluate(() => `${location.pathname}${location.search}`);
    check(`${label} search is encoded in the list URL`, /[?&]q=e(?:&|$)/.test(typedUrl), typedUrl);

    const before = await page.evaluate(() => {
      window.scrollTo(0, 1100);
      return { requested: 1100, actual: window.scrollY };
    });
    await page.waitForTimeout(150);
    check(`${label} list can scroll before opening`, before.actual > 0, before);

    const rows = page.getByTestId("member-row");
    const count = await rows.count();
    check(`${label} settled list has rows`, count > 0, count);
    await rows.first().click();
    await page.waitForURL(/\/owner\/members\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await page.goBack();
    await page.waitForURL(/\/owner\/members(?:\?|$)/, { timeout: 20_000 });
    await page.waitForTimeout(700);

    const restored = await page.evaluate(() => ({
      search: (document.querySelector('[data-testid="members-search"]') as HTMLInputElement | null)?.value ?? null,
      scroll: window.scrollY,
      url: `${location.pathname}${location.search}`,
    }));
    check(`${label} search is restored after Back`, restored.search === "e", restored);
    check(
      `${label} scroll is restored after rows are ready`,
      Math.abs(restored.scroll - before.actual) <= 2,
      { before: before.actual, after: restored.scroll },
    );

    const theme = await page.getByTestId("theme-toggle").getAttribute("aria-label");
    if (theme && /Mint/.test(theme)) {
      await page.getByTestId("theme-toggle").click();
      await page.waitForTimeout(250);
    }
  }

  await run("Mint");
  await run("Lavender");

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
