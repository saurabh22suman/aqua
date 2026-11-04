#!/usr/bin/env tsx
/**
 * Owner OpenPen · system lane — rendered acceptance probe.
 *
 * This is a REAL Chrome acceptance test, not a source/class dump. It signs
 * in to the disposable preview and measures computed geometry on the
 * authenticated /owner page:
 *
 *   - desktop sidebar width (reference 190px)
 *   - header height (reference 62px)
 *   - content inset from owner-content's left edge to the FIRST content
 *     element's left edge (reference 28px desktop, 16px phone)
 *   - rendered h1 scale (reference 22px)
 *   - Home's money/decision -> sessions/capacity order
 *   - phone: sidebar hidden, four bottom-nav links, 16px inset
 *
 * It writes measurements and screenshots FIRST, then throws a collected
 * violation list — so the run fails on the current baseline without
 * losing evidence. The same file is the GREEN acceptance after the fix.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3271";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ??
  "docs/design/owner-openpen-20261029/evidence/system-red";

async function signIn(
  context: BrowserContext,
  phone = PHONE,
  pin = PIN,
) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator('form button[type="submit"]');
    let enabled = false;
    for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
      await page.fill("#login-phone", phone);
      await page.fill("#login-pin", pin);
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(1000);
    }
    if (!enabled) throw new Error("sign-in button never enabled");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close();
  }
}

async function measure(page: Page, label: string) {
  await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
  // OwnerChromeOffset publishes the sticky banner height after mount; the
  // sidebar height/account position depend on it. Wait for the settled
  // value (a no-banner deployment legitimately stays 0px, so this wait is
  // bounded and non-fatal).
  await page
    .waitForFunction(
      () => {
        const shell = document.querySelector('[data-testid="owner-shell"]');
        if (!shell) return false;
        const value = getComputedStyle(shell).getPropertyValue("--app-sticky-offset").trim();
        return value !== "" && value !== "0px";
      },
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
  // String-form evaluate: avoids tsx/esbuild's __name helper leaking into
  // Playwright's serialized function.
  const result = await page.evaluate(`(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        left: Math.round(r.left * 100) / 100,
        top: Math.round(r.top * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        display: s.display,
        paddingLeft: s.paddingLeft,
        paddingTop: s.paddingTop,
        backgroundColor: s.backgroundColor,
        borderRadius: s.borderRadius,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
      };
    };
    const content = box('[data-testid="owner-content"]');
    const sidebar = box('[data-testid="owner-sidebar"]');
    const header = box('[data-testid="owner-top-bar"]');
    const main = document.querySelector('[data-testid="owner-home"]');
    const h1 = document.querySelector("h1");
    // FIRST content = the h1, else the first element child of main.
    const firstContent = h1 ?? (main ? main.firstElementChild : null);
    const firstBox = firstContent
      ? (() => {
          const r = firstContent.getBoundingClientRect();
          return { left: Math.round(r.left * 100) / 100, tag: firstContent.tagName };
        })()
      : null;
    const inset =
      content && firstBox
        ? Math.round((firstBox.left - content.left) * 100) / 100
        : null;
    const lead = document.querySelector('[data-testid="owner-home-lead"]');
    const money = document.querySelector('[data-testid="owner-home-money-surface"]');
    const moneyBox = money ? box('[data-testid="owner-home-money-surface"]') : null;
    const attentionPanel = document.querySelector(
      '[data-testid="owner-home-attention"]',
    );
    const attentionTitle = attentionPanel?.querySelector('li span.block');
    const attentionPanelRect = attentionPanel
      ? attentionPanel.getBoundingClientRect()
      : null;
    const attentionTitleRect = attentionTitle
      ? attentionTitle.getBoundingClientRect()
      : null;
    const attentionTextIndent =
      attentionPanelRect && attentionTitleRect
        ? Math.round((attentionTitleRect.left - attentionPanelRect.left - 20) * 100) / 100
        : null;
    const attentionFirstRow = document.querySelector(
      '[data-testid="owner-home-attention"] li',
    );
    const mobileNav = document.querySelector(
      '[data-testid="owner-mobile-nav"] nav',
    );
    const attentionFirstRowBox = attentionFirstRow
      ? attentionFirstRow.getBoundingClientRect()
      : null;
    const attentionFirstRowTop = attentionFirstRowBox
      ? Math.round(attentionFirstRowBox.top)
      : null;
    const attentionFirstRowBottom = attentionFirstRowBox
      ? Math.round(attentionFirstRowBox.bottom)
      : null;
    const mobileNavTop = mobileNav
      ? Math.round(mobileNav.getBoundingClientRect().top)
      : null;
    const context = document.querySelector('[data-testid="owner-home-context"]');
    const contextFirstP = context?.querySelector('p') ?? null;
    const h1Top = h1 ? h1.getBoundingClientRect().top : null;
    const contextFirstPTop = contextFirstP
      ? contextFirstP.getBoundingClientRect().top
      : null;
    const contextBelowHeading =
      h1Top !== null && contextFirstPTop !== null
        ? contextFirstPTop > h1Top
        : null;
    const figure = document.querySelector('[data-testid="owner-home-money-surface-figure"]');
    const figureStyle = figure ? getComputedStyle(figure) : null;
    const leadBox = lead ? lead.getBoundingClientRect() : null;
    const moneyRect = money ? money.getBoundingClientRect() : null;
    const work = document.querySelector('[data-testid="owner-home-work"]');
    const brand = document.querySelector('[data-testid="owner-shell-brand"]');
    return {
      label: ${JSON.stringify(label)},
      url: location.pathname,
      sidebar,
      header,
      content,
      firstContent: firstBox,
      insetFromContentToFirstContent: inset,
      heading: h1
        ? {
            text: h1.textContent,
            fontSize: getComputedStyle(h1).fontSize,
            lineHeight: getComputedStyle(h1).lineHeight,
            fontFamily: getComputedStyle(h1).fontFamily,
          }
        : null,
      brandText: brand?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      contextBelowHeading,
      hasLeadBand: Boolean(lead),
      hasWorkBand: Boolean(work),
      hasCapacity: Boolean(document.querySelector('[data-testid="owner-home-capacity"]')),
      hasMoneySurface: Boolean(money),
      moneySurface: moneyBox,
      moneySurfaceShareOfLead:
        leadBox && moneyRect && leadBox.width > 0
          ? Math.round((moneyRect.width / leadBox.width) * 1000) / 1000
          : null,
      moneyFigure: figureStyle
        ? {
            text: figure.textContent,
            fontSize: figureStyle.fontSize,
            fontFamily: figureStyle.fontFamily,
          }
        : null,
      moneyText: money?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      attentionFirstRowTop,
      attentionFirstRowBottom,
      attentionTextIndent,
      mobileNavTop,
      actionsInsideLead: Boolean(lead?.querySelector('[data-testid="owner-home-actions"]')),
      actionsInsideMoney: Boolean(money?.querySelector('[data-testid="owner-home-actions"]')),
      attentionInsideLead: Boolean(lead?.querySelector('[data-testid="owner-home-attention"]')),
      todayInsideWork: Boolean(work?.querySelector('[data-testid="owner-home-today"]')),
      metricsTiles: document.querySelectorAll('[data-testid="stat-card"]').length,
      mobileNavItems: document.querySelectorAll('[data-testid="owner-mobile-nav"] a').length,
      scrollY: Math.round(window.scrollY),
      accountDebug: Array.from(
        document.querySelectorAll('[data-testid="owner-shell-account"], [data-testid="owner-header-account"]'),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          testid: el.getAttribute('data-testid'),
          display: s.display,
          visibility: s.visibility,
          left: Math.round(r.left),
          top: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height),
          text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
        };
      }),
      accountDetailsOpen: Boolean(
        document.querySelector('[data-testid="owner-header-account"] details[open]'),
      ),
      viewportHeight: document.documentElement.clientHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
    };
  })()`);
  return result as Record<string, unknown>;
}

function number(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function luminance(hex: string): number {
  const full = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(full)) return 0;
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Keyboard-focus audit on the real sidebar: Tab through the shell in the
 * dark Lavender preset and read the actual outline colour/width of each
 * sidebar/account control. The outline must clear 3:1 against its own
 * painted row surface.
 */
async function focusAudit(page: Page) {
  // Measure the settled ring, not the first frame of its colour
  // transition: reduced motion collapses the transition duration.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const toggle = page.locator('[data-testid="theme-toggle"]');
  let themeState = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme ?? "",
    label:
      document.querySelector('[data-testid="theme-toggle"]')?.getAttribute("aria-label") ??
      "",
  }));
  for (let attempt = 0; attempt < 2 && themeState.theme !== "lavender"; attempt++) {
    await toggle.click();
    await page.waitForTimeout(400);
    themeState = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme ?? "",
      label:
        document.querySelector('[data-testid="theme-toggle"]')?.getAttribute("aria-label") ??
        "",
    }));
  }
  if (themeState.theme !== "lavender") {
    throw new Error(`could not select Lavender: ${JSON.stringify(themeState)}`);
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  // Keep the account disclosure open so the real sign-out control is in
  // the keyboard sequence too.
  await page.locator('[data-testid="owner-header-account"] summary').click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });

  const stops: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 45; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(40);
    const stop = await page.evaluate(`(() => {
      const el = document.activeElement;
      if (!el) return null;
      const inSidebar = Boolean(el.closest('[data-testid="owner-side-nav"]'));
      const inAccount = Boolean(el.closest('[data-testid="owner-shell-account"]'));
      const inHeaderAccount = Boolean(el.closest('[data-testid="owner-header-account"]'));
      if (!inSidebar && !inAccount && !inHeaderAccount) return null;
      const s = getComputedStyle(el);
      const row = el.closest('a,button') ?? el;
      let node = row;
      let bg = 'rgba(0, 0, 0, 0)';
      while (node) {
        const candidate = getComputedStyle(node).backgroundColor;
        const alpha = candidate.match(/rgba?\\([^)]*,\\s*([0-9.]+)\\)/);
        const isTransparent =
          candidate === 'transparent' ||
          (alpha ? Number(alpha[1]) === 0 : false);
        if (!isTransparent) {
          bg = candidate;
          break;
        }
        node = node.parentElement;
      }
      return {
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
        tag: el.tagName,
        inSidebar,
        inAccount,
        inHeaderAccount,
        outlineColor: s.outlineColor,
        outlineWidth: s.outlineWidth,
        outlineStyle: s.outlineStyle,
        outlineOffset: s.outlineOffset,
        className: typeof el.className === 'string' ? el.className : '',
        focusRingVar: s.getPropertyValue('--focus-ring').trim(),
        navFocusVar: s.getPropertyValue('--owner-nav-focus').trim(),
        matchesFocusVisible: el.matches(':focus-visible'),
        rowBackground: bg,
        ownBackground: s.backgroundColor,
      };
    })()`);
    if (stop) stops.push(stop as Record<string, unknown>);
  }

  const failures: string[] = [];
  for (const stop of stops) {
    const width = parseFloat(String(stop.outlineWidth ?? "0"));
    const color = String(stop.outlineColor ?? "");
    const background = String(stop.rowBackground ?? "");
    const sidebarControl = stop.inSidebar === true || stop.inAccount === true;
    if (sidebarControl && color !== "rgb(184, 134, 11)") {
      failures.push(
        `owner-nav focus ring ${color} on "${String(stop.text)}", expected rgb(184, 134, 11)`,
      );
    }
    const rgba = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const hex = rgba
      ? `#${[1, 2, 3]
          .map((i) => Number(rgba[i]).toString(16).padStart(2, "0"))
          .join("")}`
      : "";
    if (width < 2) {
      failures.push(`focus ring width ${width}px on "${String(stop.text)}"`);
    }
    if (hex && /rgb/i.test(color)) {
      const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const ring = rgb
        ? `#${[1, 2, 3]
            .map((i) => Number(rgb[i]).toString(16).padStart(2, "0"))
            .join("")}`
        : "";
      if (ring) {
        const ratio = contrast(ring, hex);
        if (ratio < 3) {
          failures.push(
            `focus contrast ${ratio.toFixed(2)} on "${String(stop.text)}" (${ring} on ${hex})`,
          );
        }
      }
    }
  }
  const shot = join(OUT_DIR, "desktop-1280x900-focus-lavender.png");
  await page.screenshot({ path: shot, fullPage: false });
  return { theme: "lavender", stops, failures, screenshot: shot };
}

function collectDesktopViolations(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  const sidebar = m.sidebar as Record<string, number> | null;
  const header = m.header as Record<string, number> | null;
  const heading = m.heading as Record<string, unknown> | null;
  if (number(sidebar?.width) !== 190) {
    out.push(`sidebar width ${sidebar?.width ?? "missing"}px, expected 190px`);
  }
  if (number(header?.height) !== 62) {
    out.push(`header height ${header?.height ?? "missing"}px, expected 62px`);
  }
  if (number(m.insetFromContentToFirstContent) !== 28) {
    out.push(
      `content→first-content inset ${m.insetFromContentToFirstContent ?? "missing"}px, expected 28px`,
    );
  }
  if (parseFloat(String(heading?.fontSize ?? "").replace("px", "")) !== 22) {
    out.push(`h1 size ${String(heading?.fontSize)}, expected 22px`);
  }
  if (String(heading?.text ?? "") !== "Club overview") {
    out.push(`h1 "${String(heading?.text ?? "")}", expected "Club overview"`);
  }
  if (m.contextBelowHeading !== true) {
    out.push("date/context is not below the Club overview heading");
  }
  if (!String(m.brandText ?? "").startsWith("KhelSuite")) {
    out.push(`brand "${String(m.brandText ?? "")}", expected KhelSuite`);
  }
  for (const key of [
    "hasLeadBand",
    "hasWorkBand",
    "hasCapacity",
    "hasMoneySurface",
    "actionsInsideMoney",
    "attentionInsideLead",
    "todayInsideWork",
  ]) {
    if (!m[key]) out.push(`${key} is false (reference Home hierarchy missing)`);
  }
  const moneyFigure = m.moneyFigure as Record<string, unknown> | null;
  if (parseFloat(String(moneyFigure?.fontSize ?? "").replace("px", "")) !== 36) {
    out.push(
      `money figure size ${String(moneyFigure?.fontSize ?? "missing")}, expected 36px`,
    );
  }
  if (number(m.moneySurfaceShareOfLead) === null || number(m.moneySurfaceShareOfLead)! < 0.55) {
    out.push(
      `money surface share ${String(m.moneySurfaceShareOfLead ?? "missing")}, expected >= 0.55 of the lead`,
    );
  }
  const moneyText = String(m.moneyText ?? "");
  for (const phrase of ["Collected today", "Outstanding now", "Overdue now"]) {
    if (!moneyText.includes(phrase)) out.push(`money surface missing "${phrase}"`);
  }
  if (m.metricsTiles !== 0) {
    out.push(`${String(m.metricsTiles)} competing KPI tiles, expected the unified money surface`);
  }
  const moneySurface = m.moneySurface as Record<string, unknown> | null;
  if (
    !moneySurface ||
    String(moneySurface.backgroundColor ?? "rgba(0, 0, 0, 0)") === "rgba(0, 0, 0, 0)"
  ) {
    out.push("money surface has no painted tinted background");
  }
  if (m.attentionTextIndent !== null && Number(m.attentionTextIndent) > 6) {
    out.push(
      `attention row text is indented ${String(m.attentionTextIndent)}px by a decorative icon, expected flat reference rows`,
    );
  }
  const account = (m.accountDebug as Array<Record<string, unknown>> | undefined)?.find(
    (item) => item.testid === "owner-shell-account",
  );
  if (
    account &&
    Number(account.top) + Number(account.height) >
      Number(m.viewportHeight) + 1
  ) {
    out.push(
      `sidebar account bottom ${Number(account.top) + Number(account.height)} exceeds viewport ${String(m.viewportHeight)}`,
    );
  }
  return out;
}

function collectPhoneViolations(m: Record<string, unknown>): string[] {
  const out: string[] = [];
  const sidebar = m.sidebar as Record<string, string | number> | null;
  if (number(m.insetFromContentToFirstContent) !== 16) {
    out.push(
      `phone content inset ${m.insetFromContentToFirstContent ?? "missing"}px, expected 16px`,
    );
  }
  if (sidebar?.display !== "none") {
    out.push(`phone sidebar display ${String(sidebar?.display)}, expected none`);
  }
  if (m.mobileNavItems !== 4) {
    out.push(`phone nav ${String(m.mobileNavItems)} links, expected 4`);
  }
  if ((m.documentScrollWidth as number) > (m.documentClientWidth as number)) {
    out.push(
      `phone horizontal overflow ${String(m.documentScrollWidth)}>${String(m.documentClientWidth)}`,
    );
  }
  if (
    m.attentionFirstRowTop === null ||
    m.attentionFirstRowBottom === null ||
    m.mobileNavTop === null ||
    Number(m.attentionFirstRowBottom) > Number(m.mobileNavTop)
  ) {
    out.push(
      `first decision row ${String(m.attentionFirstRowTop)}–${String(m.attentionFirstRowBottom)} is not fully above the fixed nav ${String(m.mobileNavTop)}`,
    );
  }
  return out;
}

async function shellScrollProof(page: Page) {
  const stops: Array<Record<string, unknown>> = [];
  for (const [position, ratio] of [
    ["top", 0],
    ["middle", 0.5],
    ["bottom", 1],
  ] as const) {
    await page.evaluate((r) => {
      const doc = document.documentElement;
      window.scrollTo(0, Math.round((doc.scrollHeight - doc.clientHeight) * r));
    }, ratio);
    await page.waitForTimeout(250);
    stops.push(
      (await page.evaluate(`(() => {
        const box = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            height: Math.round(r.height),
          };
        };
        return {
          position: ${JSON.stringify(position)},
          scrollY: Math.round(window.scrollY),
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: document.documentElement.clientHeight,
          header: box('[data-testid="owner-top-bar"]'),
          sidebar: box('[data-testid="owner-sidebar"]'),
          sidebarStyle: (() => {
            const el = document.querySelector('[data-testid="owner-sidebar"]');
            if (!el) return null;
            const s = getComputedStyle(el);
            return {
              height: s.height,
              minHeight: s.minHeight,
              paddingTop: s.paddingTop,
              paddingBottom: s.paddingBottom,
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            };
          })(),
          account: box('[data-testid="owner-shell-account"]'),
          nav: box('[data-testid="owner-side-nav-scroll"]'),
          navScrolls:
            (document.querySelector('[data-testid="owner-side-nav-scroll"]')?.scrollHeight ?? 0) >
            (document.querySelector('[data-testid="owner-side-nav-scroll"]')?.clientHeight ?? 0),
          contentIsScroller:
            getComputedStyle(
              document.querySelector('[data-testid="owner-content"]') ?? document.body,
            ).overflowY === 'auto',
          sideways: Math.max(
            0,
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        };
      })()`)) as Record<string, unknown>,
    );
  }
  return stops;
}

async function routeProbe(page: Page, route: string, marker: string) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(marker, { timeout: 45_000 });
  await page
    .waitForFunction(
      () => {
        const shell = document.querySelector('[data-testid="owner-shell"]');
        if (!shell) return false;
        const value = getComputedStyle(shell).getPropertyValue("--app-sticky-offset").trim();
        return value !== "" && value !== "0px";
      },
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(250);
  return (await page.evaluate(`(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
    };
    const content = rect('[data-testid="owner-content"]');
    const h1 = document.querySelector('main h1');
    const h1Rect = h1 ? h1.getBoundingClientRect() : null;
    return {
      route: ${JSON.stringify(route)},
      url: location.pathname + location.search,
      sidebar: rect('[data-testid="owner-sidebar"]'),
      header: rect('[data-testid="owner-top-bar"]'),
      h1: h1 ? (h1.textContent || '').trim() : null,
      inset: content && h1Rect ? Math.round((h1Rect.left - content.left) * 100) / 100 : null,
      sidebarDisplay: (() => {
        const el = document.querySelector('[data-testid="owner-sidebar"]');
        return el ? getComputedStyle(el).display : null;
      })(),
      navSettings: Boolean(document.querySelector('[data-testid="owner-side-nav"] a[href="/owner/settings"]')),
      navItems: Array.from(document.querySelectorAll('[data-testid="owner-side-nav"] a')).map((a) => a.textContent?.trim()),
      mobileNavItems: document.querySelectorAll('[data-testid="owner-mobile-nav"] a').length,
      sideways: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      signOutVisible: (() => {
        const el = document.querySelector('[data-testid="owner-header-account"] button');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })(),
      accountSummaryVisible: (() => {
        const el = document.querySelector('[data-testid="owner-header-account"] summary');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })(),
    };
  })()`)) as Record<string, unknown>;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    browser = await chromium.launch();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signIn(context);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  const measurements: Record<string, unknown>[] = [];
  const screenshotPaths: string[] = [];
  let shortAccount: Record<string, unknown> | null = null;
  let longPageStops: Array<Record<string, unknown>> = [];
  let routeChecks: Array<Record<string, unknown>> = [];
  let dependentInsets: Array<Record<string, unknown>> = [];
  let permissionCheck: Record<string, unknown> = {};
  let failedSignOut: Record<string, unknown> = {};
  let failure: Error | null = null;
  try {
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });

    const desktop = await measure(page, "desktop-1280x900");
    measurements.push(desktop);
    const desktopShot = join(OUT_DIR, "desktop-1280x900.png");
    await page.screenshot({ path: desktopShot, fullPage: false });
    screenshotPaths.push(desktopShot);

    // Populated month: the same two chart panels on real recorded money.
    await page.goto(
      `${BASE_URL}/owner?trend=collections&period=month`,
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const monthShot = join(OUT_DIR, "desktop-1280x900-month.png");
    await page.screenshot({ path: monthShot, fullPage: false });
    screenshotPaths.push(monthShot);
    await page.locator('[data-testid="owner-home-money"]').scrollIntoViewIfNeeded();
    await page
      .waitForSelector('[data-testid="owner-home-money"] canvas', { timeout: 20_000 })
      .catch(() => {});
    await page.waitForTimeout(400);
    const monthChartsShot = join(OUT_DIR, "desktop-1280x900-month-charts.png");
    await page.screenshot({ path: monthChartsShot, fullPage: false });
    screenshotPaths.push(monthChartsShot);

    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });

    const focus = await focusAudit(page);
    screenshotPaths.push(focus.screenshot);
    // Close the disclosure and return to the top for the clean visual frame.
    if (await page.locator('[data-testid="owner-header-account"] details[open]').count()) {
      await page.locator('[data-testid="owner-header-account"] summary').click();
    }
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(150);
    const lavenderShot = join(OUT_DIR, "desktop-1280x900-lavender.png");
    await page.screenshot({ path: lavenderShot, fullPage: false });
    screenshotPaths.push(lavenderShot);

    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 1024, height: 768 });
    const tablet = await measure(page, "tablet-1024x768");
    measurements.push(tablet);
    const tabletShot = join(OUT_DIR, "tablet-1024x768.png");
    await page.screenshot({ path: tabletShot, fullPage: false });
    screenshotPaths.push(tabletShot);

    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.setViewportSize({ width: 390, height: 844 });
    const phone = await measure(page, "phone-390x844");
    measurements.push(phone);
    const phoneShot = join(OUT_DIR, "phone-390x844.png");
    await page.screenshot({ path: phoneShot, fullPage: false });
    screenshotPaths.push(phoneShot);

    // The phone in the other preset (the same markup; tokens only).
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    const phoneMintShot = join(OUT_DIR, "phone-390x844-mint.png");
    await page.screenshot({ path: phoneMintShot, fullPage: false });
    screenshotPaths.push(phoneMintShot);

    // Short desktop: the navigation scrolls on its own and the account
    // stays reachable.
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const shortDesktop = await measure(page, "short-desktop-1280x600");
    measurements.push(shortDesktop);
    await page.locator('[data-testid="owner-side-nav-scroll"]').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(150);
    shortAccount = (await page.evaluate(`(() => {
      const el = document.querySelector('[data-testid="owner-shell-account"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        display: s.display,
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        viewportHeight: document.documentElement.clientHeight,
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40),
      };
    })()`)) as Record<string, unknown> | null;
    const shortShot = join(OUT_DIR, "short-desktop-1280x600.png");
    await page.screenshot({ path: shortShot, fullPage: false });
    screenshotPaths.push(shortShot);

    // Immediately below the shell breakpoint: sidebar gone, four nav items.
    await page.setViewportSize({ width: 1023, height: 768 });
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
    const belowBreakpoint = await measure(page, "below-breakpoint-1023x768");
    measurements.push(belowBreakpoint);
    const belowShot = join(OUT_DIR, "below-breakpoint-1023x768.png");
    await page.screenshot({ path: belowShot, fullPage: false });
    screenshotPaths.push(belowShot);

    // A 640×450 CSS viewport is the LAYOUT of 1280×900 at 200% zoom
    // (a reflow proxy, not a browser-zoom claim).
    await page.setViewportSize({ width: 640, height: 450 });
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
    const zoomProxy = await measure(page, "zoom-200-proxy-640x450");
    measurements.push(zoomProxy);
    const zoomShot = join(OUT_DIR, "zoom-200-proxy-640x450.png");
    await page.screenshot({ path: zoomShot, fullPage: false });
    screenshotPaths.push(zoomShot);

    // Long-page shell proof on a real, non-Home route (Members).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/owner/members`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('main', { timeout: 45_000 });
    await page.waitForTimeout(500);
    longPageStops = await shellScrollProof(page);
    for (const stop of longPageStops) {
      const shot = join(OUT_DIR, `members-${String(stop.position)}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      screenshotPaths.push(shot);
    }

    // Shared shell on dependent routes + a real form.
    routeChecks = [];
    for (const [route, marker, file] of [
      ["/owner/fees", "main h1", "fees-1280x900.png"],
      ["/owner/settings", "main h1", "settings-1280x900.png"],
      ["/owner/members/new", '[data-testid="member-full-name"]', "member-new-1280x900.png"],
    ] as const) {
      const check = await routeProbe(page, route, marker);
      routeChecks.push(check);
      const shot = join(OUT_DIR, file);
      await page.screenshot({ path: shot, fullPage: false });
      screenshotPaths.push(shot);
    }
    dependentInsets = routeChecks.map((r) => ({
      route: r.route,
      inset: r.inset,
      h1: r.h1,
    }));

    // Failed sign-out: abort the server action and prove the control
    // reports the failure, stays on the page and re-enables.
    const signOutContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await signIn(signOutContext, PHONE, PIN);
      const signOutPage = await signOutContext.newPage();
      await signOutPage.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
      await signOutPage.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
      await signOutPage.route("**/*", (route) =>
        route.request().method() === "POST" ? route.abort() : route.continue(),
      );
      await signOutPage.locator('[data-testid="owner-header-account"] summary').click();
      const signOutButton = signOutPage
        .locator('[data-testid="owner-header-account"] button[type="submit"]')
        .filter({ hasText: "Sign out" });
      await signOutButton.click();
      const alert = signOutPage.getByRole("alert").filter({
        hasText: /Could not finish signing out/,
      });
      await alert.waitFor({ timeout: 15_000 });
      failedSignOut = {
        errorVisible: await alert.isVisible(),
        text: (await alert.textContent())?.replace(/\s+/g, " ").trim(),
        stillOnOwner: new URL(signOutPage.url()).pathname === "/owner",
        buttonVisible: await signOutButton.isVisible(),
      };
      const shot = join(OUT_DIR, "owner-signout-failed-1280x900.png");
      await signOutPage.screenshot({ path: shot, fullPage: false });
      screenshotPaths.push(shot);
      await signOutPage.close();
    } finally {
      await signOutContext.close();
    }

    // Permission-limited shell: the accountant lands on Fees, has no
    // Settings destination, and can still reach sign-out.
    const accountantContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    permissionCheck = {};
    try {
      await signIn(accountantContext, "+919000000006", PIN);
      const accountantPage = await accountantContext.newPage();
      await accountantPage.goto(`${BASE_URL}/owner`, {
        waitUntil: "domcontentloaded",
      });
      await accountantPage.waitForURL((url) => url.pathname === "/owner/fees", {
        timeout: 45_000,
      });
      const accountantCheck = await routeProbe(
        accountantPage,
        "/owner/fees",
        "main h1",
      );
      permissionCheck = {
        redirectedTo: accountantCheck.url,
        ...accountantCheck,
      };
      const shot = join(OUT_DIR, "accountant-fees-1280x900.png");
      await accountantPage.screenshot({ path: shot, fullPage: false });
      screenshotPaths.push(shot);
      await accountantPage.close();
    } finally {
      await accountantContext.close();
    }

    const violations = [
      ...collectDesktopViolations(desktop),
      ...collectPhoneViolations(phone),
      ...focus.failures,
    ];
    if (
      !shortAccount ||
      (shortAccount as Record<string, unknown>).display === "none" ||
      Number((shortAccount as Record<string, unknown>).bottom) >
        Number((shortAccount as Record<string, unknown>).viewportHeight) + 1
    ) {
      violations.push(
        `short desktop account not reachable: ${JSON.stringify(shortAccount)}`,
      );
    }
    const belowSidebar = belowBreakpoint.sidebar as Record<string, unknown> | null;
    if (belowSidebar?.display !== "none") {
      violations.push(
        `below-breakpoint sidebar display ${String(belowSidebar?.display)}, expected none`,
      );
    }
    if (belowBreakpoint.mobileNavItems !== 4) {
      violations.push(
        `below-breakpoint nav ${String(belowBreakpoint.mobileNavItems)} links, expected 4`,
      );
    }
    if (
      (zoomProxy.documentScrollWidth as number) >
      (zoomProxy.documentClientWidth as number)
    ) {
      violations.push(
        `200% reflow proxy horizontal overflow ${String(zoomProxy.documentScrollWidth)}>${String(zoomProxy.documentClientWidth)}`,
      );
    }
    for (const stop of longPageStops) {
      const sidebar = stop.sidebar as Record<string, unknown> | null;
      if (!sidebar || Number(sidebar.height) <= 0) {
        violations.push(`Members ${String(stop.position)}: sidebar not visible`);
      }
      if (stop.contentIsScroller === true) {
        violations.push(`Members ${String(stop.position)}: content is a nested scroller`);
      }
      if (Number(stop.sideways) > 0) {
        violations.push(`Members ${String(stop.position)}: sideways overflow`);
      }
    }
    for (const check of routeChecks) {
      const sidebar = check.sidebar as Record<string, unknown> | null;
      const header = check.header as Record<string, unknown> | null;
      if (Number(sidebar?.width) !== 190) {
        violations.push(`${String(check.route)}: sidebar ${String(sidebar?.width)}px, expected 190px`);
      }
      if (Number(header?.height) !== 62) {
        violations.push(`${String(check.route)}: header ${String(header?.height)}px, expected 62px`);
      }
      if (Number(check.sideways) > 0) {
        violations.push(`${String(check.route)}: sideways overflow`);
      }
    }
    if (permissionCheck.redirectedTo !== "/owner/fees") {
      violations.push(
        `accountant /owner redirect ${String(permissionCheck.redirectedTo)}, expected /owner/fees`,
      );
    }
    if (permissionCheck.navSettings === true) {
      violations.push("accountant sidebar offers Settings, expected permission-filtered nav");
    }
    if (permissionCheck.accountSummaryVisible !== true) {
      violations.push("accountant account/sign-out summary is not visible");
    }
    if (failedSignOut.errorVisible !== true) {
      violations.push("failed sign-out did not expose its error feedback");
    }
    if (failedSignOut.stillOnOwner !== true) {
      violations.push("failed sign-out left the owner page");
    }
    if (failedSignOut.buttonVisible !== true) {
      violations.push("failed sign-out did not re-enable the sign-out control");
    }
    writeFileSync(
      join(OUT_DIR, "focus-audit.json"),
      JSON.stringify(focus, null, 2),
    );
    if (violations.length > 0) {
      failure = new Error(
        `Rendered acceptance failed (${violations.length}):\n- ${violations.join("\n- ")}`,
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    writeFileSync(
      join(OUT_DIR, "measurements.json"),
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          at: new Date().toISOString(),
          mode: "rendered acceptance (pre-implementation run is the intended RED)",
          measurements,
          shortAccount,
          longPageStops,
          routeChecks,
          dependentInsets,
          permissionCheck,
          failedSignOut,
          screenshots: screenshotPaths,
          consoleErrors,
          failure: failure?.message ?? null,
        },
        null,
        2,
      ),
    );
    await page.close();
    await context.close();
    await browser.close();
  }
  if (failure) throw failure;
  console.log("RENDERED ACCEPTANCE PASS");
  console.log(JSON.stringify(measurements, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
