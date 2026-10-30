// Owner OpenPen mobile slice — narrow/enlarged form probe.
//
// Measures real rendered behaviour on the owned disposable preview:
// no page-level horizontal overflow at 320/390/430, every visible
// form control uses 16px text, and no control is clipped outside the
// viewport. A 640px viewport is a REFLOW PROXY for browser zoom, not
// real 200%/400% zoom evidence.
import { chromium, type Page } from "playwright";

const BASE = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3274";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

type Failure = string;

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const submit = page.locator('form button[type="submit"]');
  await page.fill("#login-phone", PHONE);
  await page.fill("#login-pin", PIN);
  await page.locator("#login-pin").blur();
  await page.waitForFunction(() => {
    const button = document.querySelector(
      'form button[type="submit"]',
    ) as HTMLButtonElement | null;
    return Boolean(button && !button.disabled);
  });
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    }),
    submit.click(),
  ]);
}

async function check(page: Page, route: string, width: number) {
  const failures: Failure[] = [];
  await page.setViewportSize({ width, height: 640 });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth,
  );
  if (overflow > 1)
    failures.push(`${route} @${width}: page overflow ${overflow}px`);

  const smallControls = await page.evaluate(() => {
    const typed =
      'input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea';
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(typed),
    ).filter((el) => el.offsetParent !== null);
    return nodes
      .map((el) => ({
        id: el.id || el.getAttribute("name") || el.tagName.toLowerCase(),
        size: Number.parseFloat(getComputedStyle(el).fontSize),
      }))
      .filter((entry) => entry.size < 16);
  });
  for (const control of smallControls)
    failures.push(
      `${route} @${width}: ${control.id} text ${control.size}px < 16px`,
    );

  const clipped = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        "input, select, textarea, button, a",
      ),
    ).filter((el) => el.offsetParent !== null);
    return nodes
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
      })
      .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent ?? el.id).trim().slice(0, 30)}`);
  });
  for (const item of clipped) failures.push(`${route} @${width}: clipped ${item}`);

  return failures;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/owner/enquiries`, { waitUntil: "networkidle" });
    const enquiryHref = await page
      .locator('a[href^="/owner/enquiries/"]')
      .first()
      .getAttribute("href");
    if (!enquiryHref) throw new Error("no enquiry row to open");

    const routes = [
      "/owner/settings",
      "/owner/settings/academy",
      "/owner/settings/alerts",
      "/owner/staff",
      "/owner/staff/new",
      "/owner/staff/leave",
      "/owner/staff/roster",
      "/owner/enquiries",
      enquiryHref,
      "/owner/announcements",
      "/owner/reports",
      "/owner/reports/collections",
    ];

    const failures: Failure[] = [];
    for (const route of routes) {
      for (const width of [320, 390, 430]) {
        failures.push(...(await check(page, route, width)));
      }
      failures.push(...(await check(page, route, 640)));
    }

    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(`NARROW/FORM PASS: ${routes.length} routes x 4 widths`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

void main();
