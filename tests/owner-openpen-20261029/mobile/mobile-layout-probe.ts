#!/usr/bin/env tsx
/**
 * Mobile slice probe — exact narrow/short layout checks.
 *
 * No product writes. Authenticates to the disposable preview and measures:
 *   - PageHeader + SectionHeader at 320/360/390/430/640x360
 *   - import StickyActionBar width/targets
 *   - calendar agenda Dialog bounds, close target and focus return
 * Only genuine failures are thrown after evidence is written.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3271";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ??
  "docs/design/owner-openpen-20261029/mobile-20261029/evidence/layout-probe";

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "640x360-landscape", width: 640, height: 360 },
];

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator('form button[type="submit"]');
    for (let attempt = 0; attempt < 6; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      const enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (enabled) {
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith("/login"), {
            timeout: 30_000,
          }),
          submit.click(),
        ]);
        return;
      }
      await page.waitForTimeout(800);
    }
    throw new Error("sign-in never enabled");
  } finally {
    await page.close();
  }
}


async function homeHeader(page: Page) {
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
  await page.waitForTimeout(250);
  return (await page.evaluate(`(() => {
    const r = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) };
    };
    const h1 = document.querySelector('h1');
    const action = document.querySelector('[data-testid="owner-home-context"] [data-testid="owner-home-illustration"]');
    const section = document.querySelector('[data-testid="owner-home-today"] h2');
    const trailing = document.querySelector('[data-testid="owner-home-today"] a');
    const h = h1?.getBoundingClientRect();
    const a = action?.getBoundingClientRect();
    const s = section?.getBoundingClientRect();
    const t = trailing?.getBoundingClientRect();
    const targets = (selector) => Array.from(document.querySelectorAll(selector)).map((el) => {
      const b = el.getBoundingClientRect();
      return { text: (el.textContent || '').trim().slice(0, 32), width: Math.round(b.width), height: Math.round(b.height) };
    });
    const chartTargets = {
      period: targets('[data-testid="owner-home-money"] nav[aria-label="Period"] a'),
      metric: targets('[data-testid="owner-home-money"] nav[aria-label="Metric"] a'),
      history: targets('[data-testid="owner-home-money-trends"] a'),
      mixGroup: targets('[data-testid="owner-payment-mix-legend"] a'),
      mixMethod: targets('[data-testid="owner-payment-mix-method-link"]'),
    };
    return {
      h1: h ? { left: Math.round(h.left), right: Math.round(h.right), width: Math.round(h.width), height: Math.round(h.height) } : null,
      action: a ? { left: Math.round(a.left), right: Math.round(a.right) } : null,
      section: s ? { left: Math.round(s.left), right: Math.round(s.right), width: Math.round(s.width) } : null,
      trailing: t ? { left: Math.round(t.left), right: Math.round(t.right), minHeight: Math.round(t.height) } : null,
      headerActionOverlap: Boolean(h && a && h.right > a.left && h.bottom > a.top),
      sectionTrailingOverlap: Boolean(s && t && s.right > t.left),
      chartTargets,
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  })()`)) as Record<string, unknown>;
}

async function importBar(page: Page): Promise<Record<string, unknown> | null> {
  await page.goto(`${BASE_URL}/owner/members/import`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#member-import-file", { timeout: 45_000 });
  await page.waitForTimeout(800);
  // A preview-only synthetic CSV. Nothing is committed; this reveals the
  // sticky action bar that exists only after a checked preview.
  await page.setInputFiles("#member-import-file", {
    name: "synthetic-mobile-probe.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "full_name,date_of_birth,location\nSynthetic Mobile Probe,1990-01-01,Worli Main\n",
      "utf8",
    ),
  });
  await page
    .waitForSelector('[data-testid="sticky-action-bar"]', { timeout: 8_000 })
    .catch(() => {});
  if ((await page.locator('[data-testid="sticky-action-bar"]').count()) === 0) {
    return {
      error: "sticky action bar did not appear after preview",
      files: await page
        .locator("#member-import-file")
        .evaluate((el) => (el as HTMLInputElement).files?.length ?? 0),
      pageText: (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600),
    };
  }
  await page.waitForTimeout(100);
  const measureBar = async () =>
    (await page.evaluate(`(() => {
      const bar = document.querySelector('[data-testid="sticky-action-bar"]');
      if (!bar) return null;
      const r = bar.getBoundingClientRect();
      const buttons = Array.from(bar.querySelectorAll('button, a')).map((el) => {
        const b = el.getBoundingClientRect();
        return { text: (el.textContent || '').trim().slice(0, 40), width: Math.round(b.width), height: Math.round(b.height), bottom: Math.round(b.bottom) };
      });
      return {
        bar: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        buttons,
        overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      };
    })()`)) as Record<string, unknown> | null;
  const initial = await measureBar();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const stuck = await measureBar();
  return initial ? { ...initial, initialBar: initial.bar, initialButtons: initial.buttons, stuck } : null;
}


async function memberDateField(page: Page) {
  await page.goto(`${BASE_URL}/owner/members/new`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="member-dob"]', { timeout: 45_000 });
  await page.waitForTimeout(250);
  return (await page.evaluate(`(() => {
    const input = document.querySelector('[data-testid="member-dob"]');
    if (!input) return null;
    const r = input.getBoundingClientRect();
    const describedBy = (input.getAttribute('aria-describedby') || '').split(/\\s+/).filter(Boolean);
    const helper = Array.from(document.querySelectorAll('p')).find((el) => (el.textContent || '').includes('Format: DD/MM/YYYY'));
    return {
      height: Math.round(r.height),
      width: Math.round(r.width),
      fontSize: getComputedStyle(input).fontSize,
      describedBy,
      helperId: helper?.id ?? null,
      helperReferenced: Boolean(helper && helper.id && describedBy.includes(helper.id)),
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  })()`)) as Record<string, unknown> | null;
}

async function calendarDialog(page: Page) {
  await page.goto(`${BASE_URL}/owner/schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="owner-calendar"]', { timeout: 45_000 });
  await page.waitForTimeout(400);
  const item = page.locator('[data-testid="calendar-agenda-item"]').first();
  if ((await item.count()) === 0) {
    return { opened: false, reason: "no agenda item on this viewport" };
  }
  await item.click();
  const dialog = page.locator("dialog[open]");
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(200);
  const rect = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const close = el.querySelector(
      'button[aria-label="Close"]',
    ) as HTMLElement | null;
    const c = close?.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      width: Math.round(r.width),
      height: Math.round(r.height),
      scrollHeight: (el as HTMLElement).scrollHeight,
      clientHeight: (el as HTMLElement).clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      maxHeight: getComputedStyle(el).maxHeight,
      lastControl: (() => {
        const controls = Array.from(el.querySelectorAll('button, a')).filter((node) => {
          const b = node.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        });
        const last = controls.at(-1);
        if (!last) return null;
        const b = last.getBoundingClientRect();
        return { text: (last.textContent || '').trim().slice(0, 40), top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
      })(),
      close: c ? { width: Math.round(c.width), height: Math.round(c.height) } : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  const triggerId = await item.getAttribute("data-event-id");
  await dialog.locator('button[aria-label="Close"]').click();
  await page.waitForTimeout(200);
  const focusReturned = await page.evaluate(
    (id) => document.activeElement?.getAttribute("data-event-id") === id,
    triggerId,
  );
  return { opened: true, rect, focusReturned };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    browser = await chromium.launch();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signIn(context);
  const page = await context.newPage();
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  try {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const home = await homeHeader(page);
      const imp = await importBar(page);
      const dialog = await calendarDialog(page);
      const dob = await memberDateField(page);
      rows.push({ viewport: vp, home, importBar: imp, dialog, memberDob: dob });
      const overflow = home.overflow as Record<string, number>;
      if (overflow.scrollWidth > overflow.clientWidth) {
        failures.push(`${vp.name}: Home horizontal overflow ${overflow.scrollWidth}>${overflow.clientWidth}`);
      }
      if (home.headerActionOverlap === true) {
        failures.push(`${vp.name}: PageHeader title overlaps its action`);
      }
      if (home.sectionTrailingOverlap === true) {
        failures.push(`${vp.name}: SectionHeader title overlaps its trailing link`);
      }
      const chartTargets = home.chartTargets as Record<string, Array<Record<string, unknown>>>;
      for (const [group, targets] of Object.entries(chartTargets ?? {})) {
        for (const target of targets ?? []) {
          if (Number(target.height) < 44) {
            failures.push(`${vp.name}: chart ${group} "${String(target.text)}" target is ${String(target.height)}px, expected >=44px`);
          }
        }
      }
      if (imp && imp.error) {
        failures.push(`${vp.name}: import preview did not expose the sticky bar`);
      } else if (imp) {
        const stuck = imp.stuck as Record<string, unknown> | null;
        const bar = (stuck?.bar ?? imp.bar) as Record<string, number>;
        const viewport = (stuck?.viewport ?? imp.viewport) as Record<string, number>;
        if (bar.left < 0 || bar.right > viewport.width + 1) {
          failures.push(`${vp.name}: StickyActionBar crosses the viewport`);
        }
        if (bar.top < 0 || bar.bottom > viewport.height + 1) {
          failures.push(`${vp.name}: stuck StickyActionBar ${bar.top}–${bar.bottom} exceeds viewport ${viewport.height}`);
        }
        const buttons = (stuck?.buttons ?? imp.buttons) as Array<Record<string, unknown>>;
        for (const button of buttons ?? []) {
          if (Number(button.height) < 44) {
            failures.push(`${vp.name}: StickyActionBar target "${String(button.text)}" is ${String(button.height)}px`);
          }
          if (Number(button.bottom) > viewport.height + 1) {
            failures.push(`${vp.name}: StickyActionBar target "${String(button.text)}" bottom ${String(button.bottom)} exceeds viewport`);
          }
        }
        const io = (stuck?.overflow ?? imp.overflow) as Record<string, number>;
        if (io.scrollWidth > io.clientWidth) {
          failures.push(`${vp.name}: import page horizontal overflow`);
        }
      }
      if (dob) {
        if (Number(dob.height) < 48 || dob.fontSize !== "16px") {
          failures.push(`${vp.name}: DateField is ${String(dob.height)}px / ${String(dob.fontSize)}, expected 48px / 16px`);
        }
        if (dob.helperReferenced !== true) {
          failures.push(`${vp.name}: DateField format helper is not referenced`);
        }
        const o = dob.overflow as Record<string, number>;
        if (o.scrollWidth > o.clientWidth) {
          failures.push(`${vp.name}: members-new horizontal overflow`);
        }
      }
      if (dialog.opened) {
        const rect = dialog.rect as {
          top: number;
          bottom: number;
          left: number;
          right: number;
          scrollHeight: number;
          clientHeight: number;
          overflowY: string;
          viewport: { width: number; height: number };
        };
        if (rect.top < -1 || rect.bottom > rect.viewport.height + 1) {
          failures.push(`${vp.name}: Dialog ${rect.top}–${rect.bottom} exceeds viewport ${rect.viewport.height}`);
        }
        if (rect.left < -1 || rect.right > rect.viewport.width + 1) {
          failures.push(`${vp.name}: Dialog crosses viewport width`);
        }
        if (dialog.focusReturned !== true) {
          failures.push(`${vp.name}: Dialog did not return focus to its trigger`);
        }
        if (
          rect.scrollHeight > rect.clientHeight &&
          !["auto", "scroll"].includes(String(rect.overflowY))
        ) {
          failures.push(`${vp.name}: Dialog clips ${String(rect.scrollHeight - rect.clientHeight)}px with overflow ${String(rect.overflowY)}`);
        }
      }
    }
  } finally {
    writeFileSync(
      join(OUT_DIR, "layout-probe.json"),
      JSON.stringify({ at: new Date().toISOString(), rows, failures }, null, 2),
    );
    await page.close();
    await context.close();
    await browser.close();
  }
  if (failures.length > 0) {
    throw new Error(`Layout probe failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  }
  console.log("MOBILE LAYOUT PROBE PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
