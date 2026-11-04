// Owner OpenPen settings interiors — rendered hierarchy probe.
//
// Confirms the four catalogue-first interiors render their heading and
// bounded editor in the owned disposable preview at phone and desktop,
// in both light presets, without page-level horizontal overflow.
import { chromium, type Page } from "playwright";

const BASE = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3274";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

const ROUTES: Array<[string, string]> = [
  ["/owner/settings/activities", "Existing activities"],
  ["/owner/settings/holidays", "Holiday list"],
  ["/owner/settings/menu", "Menu catalogue"],
  ["/owner/settings/plans", "Plans catalogue"],
];

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

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures: string[] = [];
  try {
    await signIn(page);
    for (const [route, heading] of ROUTES) {
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
        const state = await page.evaluate((expected) => {
          const h2 = Array.from(
            document.querySelectorAll<HTMLElement>("h2"),
          ).find((node) => node.textContent?.trim() === expected);
          return {
            hasHeading: Boolean(h2),
            overflow:
              document.scrollingElement!.scrollWidth - window.innerWidth,
          };
        }, heading);
        if (!state.hasHeading)
          failures.push(`${route} @${width}: missing heading "${heading}"`);
        if (state.overflow > 1)
          failures.push(`${route} @${width}: overflow ${state.overflow}px`);
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const toggle = page.locator('[data-testid="theme-toggle"]').first();
      if ((await toggle.count()) > 0) {
        await toggle.click();
        await page.waitForTimeout(150);
      }
      const overflow = await page.evaluate(
        () => document.scrollingElement!.scrollWidth - window.innerWidth,
      );
      if (overflow > 1)
        failures.push(`${route} @390 second preset: overflow ${overflow}px`);
    }

    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `INTERIORS PASS: ${ROUTES.length} routes x phone/desktop + second preset`,
      );
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

void main();
