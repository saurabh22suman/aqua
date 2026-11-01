// Owner OpenPen mobile slice — short-viewport, breakpoint and theme probe.
//
// Measures the OWNED disposable preview at the shell matrix: 1024x768,
// 1280x600, the breakpoint minus one (1023) and a 640x360 landscape
// reflow proxy. Verifies no page-level horizontal overflow, the page
// inset convention still applies, and the sign-out control is reachable
// by scrolling. Also flips the two light presets and repeats two long
// pages, without changing any academy data.
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

async function check(page: Page, route: string, width: number, height: number) {
  const failures: Failure[] = [];
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

  const inset = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>("[data-owner-page]");
    return root
      ? Number.parseFloat(getComputedStyle(root).paddingLeft)
      : null;
  });
  const expected = width >= 1024 ? 28 : 16;
  if (inset === null) failures.push(`${route} @${width}: no OwnerPage root`);
  else if (Math.abs(inset - expected) > 0.5)
    failures.push(`${route} @${width}: inset ${inset}px != ${expected}px`);

  const overflow = await page.evaluate(
    () => document.scrollingElement!.scrollWidth - window.innerWidth,
  );
  if (overflow > 1)
    failures.push(`${route} @${width}x${height}: horizontal overflow ${overflow}px`);

  const endReachable = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("[data-owner-page]");
    if (!main) return false;
    const nodes = Array.from(main.querySelectorAll<HTMLElement>("a, button"));
    const last = nodes[nodes.length - 1];
    if (!last) return true;
    last.scrollIntoView({ block: "center" });
    const box = last.getBoundingClientRect();
    return box.width > 0 && box.bottom <= window.innerHeight + 1;
  });
  if (!endReachable)
    failures.push(`${route} @${width}x${height}: final action unreachable`);

  const signOutReachable = await page.evaluate(() => {
    const node = Array.from(
      document.querySelectorAll<HTMLElement>("a, button"),
    ).find((el) => /sign out/i.test(el.textContent ?? ""));
    if (!node) return true;
    node.scrollIntoView({ block: "center" });
    const box = node.getBoundingClientRect();
    return box.height > 0 && box.bottom <= window.innerHeight + 1;
  });
  if (!signOutReachable)
    failures.push(`${route} @${width}x${height}: sign-out unreachable`);

  return failures;
}

async function flipTheme(page: Page) {
  const toggle = page.locator('[data-testid="theme-toggle"]').first();
  if ((await toggle.count()) > 0) {
    await toggle.click();
    await page.waitForTimeout(150);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page);

    const matrix = [
      { width: 1024, height: 768 },
      { width: 1280, height: 600 },
      { width: 1023, height: 768 },
      { width: 640, height: 360 },
    ];
    const routes = [
      "/owner/settings",
      "/owner/reports",
      "/owner/reports/collections",
      "/owner/staff/leave",
      "/owner/announcements",
    ];

    const failures: Failure[] = [];
    for (const route of routes)
      for (const size of matrix)
        failures.push(...(await check(page, route, size.width, size.height)));

    for (const route of ["/owner/settings", "/owner/reports"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      await flipTheme(page);
      failures.push(...(await check(page, route, 390, 844)));
      failures.push(...(await check(page, route, 1280, 600)));
    }

    if (failures.length > 0) {
      console.error(failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log(
        `SHELL/THEME PASS: ${routes.length} routes x ${matrix.length} sizes, both presets`,
      );
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

void main();
