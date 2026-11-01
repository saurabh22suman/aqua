// Owner OpenPen mobile slice — rendered gutter/overflow probe.
//
// Runs against the OWNED disposable preview (AQUA_E2E_BASE_URL) and
// measures the ACTUAL content inset: 28px total on a desktop content
// column and 16px on a phone, plus page-level horizontal overflow and
// primary-action reachability. It is a geometry probe, not a screenshot
// assertion; screenshots/visual judgement stay with the coordinator.
import { chromium, type Page } from "playwright";

const BASE = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3274";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

const ROUTES = [
  "/owner/settings",
  "/owner/settings/academy",
  "/owner/staff",
  "/owner/staff/roster",
  "/owner/staff/leave",
  "/owner/enquiries",
  "/owner/announcements",
  "/owner/reports",
  "/owner/reports/collections",
];

type Failure = string;

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const submit = page.locator('form button[type="submit"]');
  let enabled = false;
  for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
    await page.fill("#login-phone", PHONE);
    await page.fill("#login-pin", PIN);
    await page.locator("#login-pin").blur();
    enabled = await page.evaluate(() => {
      const button = document.querySelector(
        'form button[type="submit"]',
      ) as HTMLButtonElement | null;
      return Boolean(button && !button.disabled);
    });
    if (!enabled) await page.waitForTimeout(1000);
  }
  if (!enabled) {
    const alert = await page.evaluate(() => document.body.textContent ?? "");
    throw new Error(
      `sign-in never enabled: ${alert.replace(/\s+/g, " ").slice(0, 300)}`,
    );
  }
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    }),
    submit.click(),
  ]);
}

async function measure(page: Page, route: string, width: number, height: number) {
  const failures: Failure[] = [];
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

  const expected = width >= 1024 ? 28 : 16;
  const inset = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-owner-page]");
    if (!root) return null;
    return Number.parseFloat(getComputedStyle(root).paddingLeft);
  });
  if (inset === null) failures.push(`${route} @${width}: no [data-owner-page] root`);
  else if (Math.abs(inset - expected) > 0.5)
    failures.push(`${route} @${width}: inset ${inset}px, expected ${expected}px`);

  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth,
  );
  if (overflow > 1) failures.push(`${route} @${width}: horizontal overflow ${overflow}px`);

  const clippedAction = await page.evaluate(() => {
    const actions = Array.from(
      document.querySelectorAll<HTMLElement>(
        "[data-owner-page] a, [data-owner-page] button",
      ),
    ).filter((el) => /Add staff record|Invite staff|Daily collections|Fees & payments/.test(el.textContent ?? ""));
    return actions
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
      })
      .map((el) => el.textContent?.trim() ?? "action");
  });
  if (clippedAction.length > 0)
    failures.push(`${route} @${width}: clipped action(s) ${clippedAction.join(", ")}`);

  return failures;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);
    const failures: Failure[] = [];
    for (const route of ROUTES) {
      failures.push(...(await measure(page, route, 1280, 900)));
      failures.push(...(await measure(page, route, 390, 844)));
    }
    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(`INSET/OVERFLOW PASS: ${ROUTES.length} routes x 2 viewports`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

void main();
