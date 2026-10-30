#!/usr/bin/env tsx
/**
 * Final-gap probe — Owner Settings interiors and 320px search.
 * Read-only; only a synthetic search query. Saves exact measurements.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3271";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ??
  "docs/design/owner-openpen-20261029/mobile-20261029/evidence/final-gap-probe";

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
        const b = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null;
        return Boolean(b && !b.disabled);
      });
      if (enabled) {
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
          submit.click(),
        ]);
        return;
      }
      await page.waitForTimeout(700);
    }
    throw new Error("sign-in never enabled");
  } finally {
    await page.close();
  }
}

async function branding(page: Page) {
  await page.goto(`${BASE_URL}/owner/settings/branding`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="branding-display-name"]', { timeout: 45_000 });
  await page.waitForTimeout(250);
  return (await page.evaluate(`(() => {
    const display = document.querySelector('[data-testid="branding-display-name"]');
    if (!display) return null;
    const preview = document.querySelector('[data-testid="branding-preview"]');
    const inputRect = display.getBoundingClientRect();
    const previewRect = preview?.getBoundingClientRect();
    const accents = Array.from(document.querySelectorAll('[data-testid="branding-accent"] button')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.textContent || '').trim(),
        width: Math.round(r.width),
        height: Math.round(r.height),
        clipped: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      };
    });
    const save = document.querySelector('[data-testid="branding-save"]');
    const sr = save?.getBoundingClientRect();
    const previewName = document.querySelector('[data-testid="branding-preview"] p.font-display');
    const pn = previewName?.getBoundingClientRect();
    const previewCard = document.querySelector('[data-testid="branding-preview"] > div');
    const pc = previewCard?.getBoundingClientRect();
    return {
      input: { height: Math.round(inputRect.height), width: Math.round(inputRect.width), fontSize: getComputedStyle(display).fontSize },
      preview: previewRect ? { left: Math.round(previewRect.left), top: Math.round(previewRect.top), right: Math.round(previewRect.right), bottom: Math.round(previewRect.bottom) } : null,
      display: { left: Math.round(inputRect.left), top: Math.round(inputRect.top) },
      sideBySide: Boolean(previewRect && previewRect.left > inputRect.left && previewRect.top <= inputRect.top + 100),
      previewName: previewName && pn ? {
        width: Math.round(pn.width),
        left: Math.round(pn.left),
        right: Math.round(pn.right),
        scrollWidth: previewName.scrollWidth,
        clipped: previewName.scrollWidth > previewName.clientWidth + 1,
        overflowsCard: Boolean(pc && pn.right > pc.right - 20 + 1),
      } : null,
      accents,
      save: sr ? { height: Math.round(sr.height), width: Math.round(sr.width) } : null,
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  })()`)) as Record<string, unknown>;
}

async function skills(page: Page) {
  await page.goto(`${BASE_URL}/owner/settings/skills`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="level-name-"]', { timeout: 45_000 });
  await page.waitForTimeout(250);
  return (await page.evaluate(`(() => {
    const level = document.querySelector('[data-testid^="level-name-"]');
    const rubric = document.querySelector('[data-testid^="skill-rubric-"]');
    const summary = document.querySelector('details summary');
    const save = Array.from(document.querySelectorAll('button')).find((b) => /Save level/.test(b.textContent || ''));
    const lr = level?.getBoundingClientRect();
    const rr = rubric?.getBoundingClientRect();
    const sr = summary?.getBoundingClientRect();
    const sv = save?.getBoundingClientRect();
    return {
      level: lr ? { height: Math.round(lr.height), width: Math.round(lr.width), fontSize: getComputedStyle(level).fontSize } : null,
      rubric: rr ? { height: Math.round(rr.height), width: Math.round(rr.width), fontSize: getComputedStyle(rubric).fontSize } : null,
      summary: sr ? { height: Math.round(sr.height), width: Math.round(sr.width) } : null,
      save: sv ? { height: Math.round(sv.height) } : null,
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  })()`)) as Record<string, unknown>;
}

async function searchAt320(page: Page): Promise<Record<string, unknown>> {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
  await page.waitForTimeout(250);
  const input = page.locator('[data-testid="global-search-input"]');
  const inputBox = await input.boundingBox();
  await input.fill("MMS");
  await input.press("Enter");
  const results = page.locator('[data-testid="global-search-results"]');
  await results.waitFor({ timeout: 20_000 }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        const r = document.querySelector('[data-testid="global-search-results"]');
        return Boolean(r && !r.querySelector('[data-testid="global-search-loading"]'));
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
  if ((await results.count()) === 0) {
    return { opened: false, inputBox };
  }
  const hit = page.locator('[data-testid^="global-search-hit-"]').first();
  const hitCount = await page.locator('[data-testid^="global-search-hit-"]').count();
  await results.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(150);
  const data = await page.evaluate(`(() => {
    const results = document.querySelector('[data-testid="global-search-results"]');
    const hits = Array.from(document.querySelectorAll('[data-testid^="global-search-hit-"]'));
    const last = hits.at(-1);
    const nav = document.querySelector('[data-testid="owner-mobile-nav"] nav');
    const rr = results?.getBoundingClientRect();
    const lr = last?.getBoundingClientRect();
    const nr = nav?.getBoundingClientRect();
    const ir = document.querySelector('[data-testid="global-search-input"]')?.getBoundingClientRect();
    const clear = document.querySelector('button[aria-label="Clear search"]')?.getBoundingClientRect();
    return {
      input: ir ? { width: Math.round(ir.width), height: Math.round(ir.height), fontSize: getComputedStyle(document.querySelector('[data-testid="global-search-input"]')).fontSize } : null,
      results: rr ? { left: Math.round(rr.left), right: Math.round(rr.right), top: Math.round(rr.top), bottom: Math.round(rr.bottom), scrollHeight: results.scrollHeight, clientHeight: results.clientHeight } : null,
      firstHit: hits[0] ? { height: Math.round(hits[0].getBoundingClientRect().height) } : null,
      lastHit: lr ? { top: Math.round(lr.top), bottom: Math.round(lr.bottom) } : null,
      navTop: nr ? Math.round(nr.top) : null,
      clear: clear ? { width: Math.round(clear.width), height: Math.round(clear.height) } : null,
      nativeSearchCancel: document.querySelector('[data-testid="global-search-input"]')?.getAttribute('type') === 'search',
      text: (results?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300),
      overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    };
  })()`);
  return { opened: true, hitCount, hitVisible: await hit.isVisible().catch(() => false), ...(data as Record<string, unknown>) };
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
  const rows: Array<Record<string, unknown>> = [];
  const failures: string[] = [];
  try {
    for (const vp of [
      { name: "320x568", width: 320, height: 568 },
      { name: "390x844", width: 390, height: 844 },
      { name: "1280x900", width: 1280, height: 900 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const b = await branding(page);
      const s = await skills(page);
      rows.push({ viewport: vp, branding: b, skills: s });
      await page.goto(`${BASE_URL}/owner/settings/branding`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="branding-display-name"]', { timeout: 45_000 });
      await page.screenshot({ path: join(OUT_DIR, `branding-${vp.name}.png`), fullPage: false });
      await page.goto(`${BASE_URL}/owner/settings/skills`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid^="level-name-"]', { timeout: 45_000 });
      await page.screenshot({ path: join(OUT_DIR, `skills-${vp.name}.png`), fullPage: false });

      const bo = b.overflow as Record<string, number>;
      const so = s.overflow as Record<string, number>;
      if (bo.scrollWidth > bo.clientWidth) failures.push(`${vp.name}: branding horizontal overflow`);
      if (so.scrollWidth > so.clientWidth) failures.push(`${vp.name}: skills horizontal overflow`);
      const bi = b.input as Record<string, unknown>;
      if (Number(bi.height) < 48 || bi.fontSize !== "16px") failures.push(`${vp.name}: branding input ${String(bi.height)}px/${String(bi.fontSize)}`);
      const sa = b.save as Record<string, unknown> | null;
      if (!sa || Number(sa.height) < 48) failures.push(`${vp.name}: branding save target below 48px`);
      for (const a of (b.accents as Array<Record<string, unknown>>) ?? []) {
        if (Number(a.height) < 44) failures.push(`${vp.name}: accent ${String(a.text)} is ${String(a.height)}px`);
        if (a.clipped) failures.push(`${vp.name}: accent ${String(a.text)} text is clipped`);
      }
      const pn = b.previewName as Record<string, unknown> | null;
      if (pn?.clipped || pn?.overflowsCard) failures.push(`${vp.name}: branding preview name is clipped`);
      if (vp.width >= 1024 && b.sideBySide !== true) failures.push(`${vp.name}: branding preview is not the reference side-by-side preview`);
      const li = s.level as Record<string, unknown> | null;
      if (!li || Number(li.height) < 48 || li.fontSize !== "16px") failures.push(`${vp.name}: skill input ${String(li?.height)}px/${String(li?.fontSize)}`);
      const rr = s.rubric as Record<string, unknown> | null;
      if (!rr || Number(rr.height) < 48 || rr.fontSize !== "16px") failures.push(`${vp.name}: rubric textarea ${String(rr?.height)}px/${String(rr?.fontSize)}`);
      const sm = s.summary as Record<string, unknown> | null;
      if (!sm || Number(sm.height) < 44) failures.push(`${vp.name}: rubric disclosure target ${String(sm?.height)}px`);
    }
    const search = await searchAt320(page);
    await page.screenshot({ path: join(OUT_DIR, "search-320x568.png"), fullPage: false });
    rows.push({ viewport: { name: "search-320x568" }, search });
    if (search.opened !== true) {
      failures.push("320: search results did not open");
    } else {
      const si = search.input as Record<string, unknown>;
      if (Number(si.height) < 48 || si.fontSize !== "16px") failures.push("320: search input target/size");
      if (search.nativeSearchCancel === true) failures.push("320: duplicate native and explicit clear affordances");
      const sh = search.firstHit as Record<string, unknown> | null;
      if (!sh || Number(sh.height) < 44) failures.push("320: search hit target below 44px");
      const lh = search.lastHit as Record<string, unknown> | null;
      const navTop = Number(search.navTop);
      if (!lh || Number(lh.bottom) > navTop + 1) failures.push("320: last search result is not reachable above the fixed nav");
    }
    // Theme switch: capture the two interiors in the other preset.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="owner-home"]', { timeout: 45_000 });
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(200);
    await page.goto(`${BASE_URL}/owner/settings/branding`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="branding-display-name"]', { timeout: 45_000 });
    await page.screenshot({ path: join(OUT_DIR, "branding-lavender-1280x900.png"), fullPage: false });
    await page.goto(`${BASE_URL}/owner/settings/skills`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid^="level-name-"]', { timeout: 45_000 });
    await page.screenshot({ path: join(OUT_DIR, "skills-lavender-1280x900.png"), fullPage: false });
  } finally {
    writeFileSync(join(OUT_DIR, "final-gap-probe.json"), JSON.stringify({ at: new Date().toISOString(), rows, failures }, null, 2));
    await page.close();
    await context.close();
    await browser.close();
  }
  if (failures.length > 0) throw new Error(`Final-gap probe failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  console.log("FINAL-GAP PROBE PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
