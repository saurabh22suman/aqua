import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Owner staff-access interiors: invitation list identity/scope and check-in
// poster containment. Bearer URLs are never written to evidence; the poster's
// QR and link are redacted before any screenshot.

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

  async function open(path: string, width: number, height = 900) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }));
  }

  for (const width of [320, 390, 430, 1280]) {
    const metrics = await open("/owner/staff/invitations", width, width === 1280 ? 900 : 844);
    const list = await page.evaluate(() => {
      const surface = document.querySelector('[data-testid="invitations-surface"]');
      const head = document.querySelector('[data-testid="invitations-head"]');
      const rows = Array.from(document.querySelectorAll('[data-testid="invitations-list"] > li'));
      const first = rows[0]?.textContent ?? "";
      const text = surface?.textContent ?? "";
      const links = Array.from(surface?.querySelectorAll("a") ?? []).map((a) => a.getAttribute("href") ?? "");
      return {
        surface: !!surface,
        head: head?.textContent ?? "",
        rows: rows.length,
        identityFirst: rows.length === 0 || first.indexOf("+91") >= 0,
        bearer: /token=/i.test(text) || links.some((href) => href.includes("/check-in/")),
      };
    });
    check(`invitations ${width}px no horizontal overflow`, metrics.overflow <= 0);
    check(`invitations ${width}px one bounded surface`, list.surface);
    check(`invitations head names person/role/location/state`, ["Person", "Role", "Location access", "State"].every((h) => list.head.includes(h)), list.head);
    check(`invitations ${width}px starts with the available identity`, list.identityFirst);
    check(`invitations ${width}px no bearer URL in the list`, !list.bearer);
  }

  await open("/owner/staff/invitations", 390, 844);
  await page.screenshot({ path: `${out}/invitations-390-mint.png` });
  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(250);
  const lavender = await open("/owner/staff/invitations", 390, 844);
  check("invitations Lavender keeps 390px reflow", lavender.overflow <= 0, lavender.overflow);
  await page.screenshot({ path: `${out}/invitations-390-lavender.png` });

  for (const width of [320, 390, 430, 1280]) {
    const metrics = await open("/owner/staff/check-in-qr", width, width === 1280 ? 900 : 844);
    const poster = await page.evaluate(() => {
      const sheet = document.querySelector('[data-testid="premises-qr-poster"]');
      const print = Array.from(document.querySelectorAll("button")).find((b) => /print poster/i.test(b.textContent ?? ""));
      return {
        sheet: !!sheet,
        printOutside: !!sheet && !!print && !sheet.contains(print),
        instructions: sheet?.textContent?.includes("Scan the academy") ?? false,
        fallback: sheet?.textContent?.includes("/check-in/") ?? false,
      };
    });
    check(`poster ${width}px no horizontal overflow`, metrics.overflow <= 0);
    check(`poster ${width}px is one print sheet`, poster.sheet);
    check(`poster ${width}px print control is outside`, poster.printOutside);
    check(`poster ${width}px carries the instruction`, poster.instructions);
    check(`poster ${width}px carries a readable fallback path`, poster.fallback);
  }

  await open("/owner/staff/check-in-qr", 390, 844);
  await page.evaluate(() => {
    document.querySelectorAll('[data-testid="link-qr"], [data-testid="link-qr-loading"]').forEach((el) => {
      (el as HTMLElement).style.visibility = "hidden";
    });
    const sheet = document.querySelector('[data-testid="premises-qr-poster"]');
    sheet?.querySelectorAll("p").forEach((p) => {
      if (p.textContent?.includes("/check-in/")) p.textContent = "[check-in link redacted]";
    });
  });
  await page.screenshot({ path: `${out}/poster-390-mint-redacted.png` });
  await page.getByTestId("theme-toggle").click();
  await page.waitForTimeout(250);
  const posterLavender = await open("/owner/staff/check-in-qr", 390, 844);
  check("poster Lavender keeps 390px reflow", posterLavender.overflow <= 0, posterLavender.overflow);

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
