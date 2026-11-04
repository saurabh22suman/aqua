#!/usr/bin/env node
/**
 * Owner Home — keyboard focus visibility on the collections hero (F1).
 *
 * READ-ONLY PROBE. It changes nothing in the application: it logs in with
 * the synthetic local credentials, walks the keyboard to each hero link and
 * MEASURES the focus ring that the browser actually paints. No style is
 * injected and no focus is set programmatically — the focus state comes from
 * real Tab presses, so `:focus-visible` behaves exactly as a keyboard user
 * sees it. Page errors are REPORTED, never suppressed.
 *
 * STATUS: this probe has NOT been run successfully against a running
 * application yet. The first attempt filled the PIN and waited for a
 * navigation that never came: the login form is a client component whose
 * submit control stays disabled until it has hydrated and the fields are
 * valid, so the form must actually be SUBMITTED. The coordinator runs this
 * against the production preview after the build; until then no result from
 * it may be claimed.
 *
 * The finding it exists to prove (REVIEW-HOME.md F1): the hero card is
 * `bg-[var(--owner-hero)]` (= --accent-strong) and the links paint their
 * ring with `var(--focus-ring)`. In BOTH presets those two tokens are the
 * SAME colour, so a 2px ring is drawn on the surface it is drawn on — the
 * ring exists but cannot be seen (WCAG 2.4.7).
 *
 * The proposed correction is a light ring on the dark hero
 * (`focus-visible:outline-[var(--owner-hero-ink)]`, white in both presets,
 * with a suitable outline-offset). This script does NOT apply it; it is the
 * measurement the coordinator runs BEFORE and AFTER that change.
 *
 * Run (the coordinator owns the preview lease):
 *   AQUA_E2E_BASE_URL=http://127.0.0.1:<port> \
 *   AQUA_E2E_OUT=docs/handoffs/evidence/owner-light-home-focus \
 *   node tests/owner-light-20261102/home/home-hero-focus-check.mts
 *
 * It writes a JSON finding file and PNG screenshots (caret: "initial", so
 * the screenshot never shows a blinking caret injected by automation) and
 * exits 1 while a ring fails the WCAG 3:1 contrast check.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3181";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/owner-light-home-focus";

const PRESETS = ["mint", "lavender"];
const TARGETS = [
  {
    key: "today",
    label: "the Today collection link",
    selector: '[data-testid="owner-home-money-surface"] a[aria-label*="collected today"]',
  },
  {
    key: "record-payment",
    label: "the Record payment action",
    selector: '[data-testid="owner-home-money-surface"] a[href*="tab=dues"]',
  },
  {
    key: "view-trend",
    label: "the View trend link",
    selector: '[data-testid="owner-home-money-surface"] a[href*="view=trends"]',
  },
];

/** The WCAG minimum for a focus indicator against what it is drawn on. */
const MINIMUM_CONTRAST = 3;

/**
 * Sign in the way a person does: fill the two fields, let the form
 * validate them, and PRESS the real submit control.
 *
 * The form is a client component: its submit button is disabled until the
 * page has hydrated and both fields are valid, so waiting for a
 * navigation without submitting never succeeds. The fill is retried a
 * bounded number of times because the first fill can land before
 * hydration.
 */
async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  const phone = page.locator("#login-phone");
  const pin = page.locator("#login-pin");
  const submit = page.getByRole("button", { name: /^sign in$/i });

  await phone.waitFor({ state: "visible", timeout: 30_000 });

  let ready = false;
  for (let attempt = 0; attempt < 10 && !ready; attempt += 1) {
    await phone.fill(PHONE);
    await pin.fill(PIN);
    // Blurring is what the form uses to normalise the number and to run
    // the PIN rule, exactly as a person leaving the field does.
    await phone.blur();
    await pin.blur();
    try {
      await submit.waitFor({ state: "visible", timeout: 2_000 });
      ready = await submit.isEnabled();
    } catch {
      ready = false;
    }
    if (!ready) await page.waitForTimeout(300);
  }
  if (!ready) {
    throw new Error("the login form's submit control never became enabled");
  }

  // The real submit. The app requires it.
  await submit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
}

/** The Owner page, hydrated, with its fonts loaded and its network quiet. */
async function openOwnerHome(page) {
  await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="owner-top-bar"]', { timeout: 30_000 });
  await page.waitForSelector('[data-testid="owner-home"]', { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
}

/** Walk the keyboard until the target holds focus. Real Tab presses only. */
async function focusWithKeyboard(page, selector, maxPresses = 120) {
  for (let i = 0; i < maxPresses; i += 1) {
    await page.keyboard.press("Tab");
    const matched = await page.evaluate(
      (sel) => document.activeElement instanceof Element && document.activeElement.matches(sel),
      selector,
    );
    if (matched) return i + 1;
  }
  return -1;
}

/** What the browser actually paints for the focused element. */
async function measureRing(page, selector) {
  return page.evaluate((sel) => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    const card = document.querySelector('[data-testid="owner-home-money-surface"]');
    const cardBackground = card instanceof HTMLElement ? getComputedStyle(card).backgroundColor : "";
    const root = getComputedStyle(document.documentElement);
    return {
      matchesTarget: element.matches(sel),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      cardBackground,
      heroToken: root.getPropertyValue("--owner-hero").trim(),
      ringToken: root.getPropertyValue("--focus-ring").trim(),
      inkToken: root.getPropertyValue("--owner-hero-ink").trim(),
    };
  }, selector);
}

/** "rgb(31, 94, 58)" → [31, 94, 58]. */
function parseColor(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec((value || "").trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

/** The WCAG relative luminance of an sRGB colour. */
function relativeLuminance(rgb) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** The WCAG contrast ratio between two opaque colours. */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * The ring is visible when it is painted at all AND it reaches the WCAG
 * 3:1 contrast against the surface it is drawn on. "A different colour"
 * is not enough: a 1.1:1 ring is still invisible to a reader.
 */
function ringVerdict(measurement) {
  if (!measurement) {
    return { visible: false, ratio: null, why: "the target never took focus" };
  }
  if (measurement.outlineStyle === "none") {
    return { visible: false, ratio: null, why: "no outline is painted at all" };
  }
  const width = Number.parseFloat(measurement.outlineWidth);
  if (!width) {
    return { visible: false, ratio: null, why: "the outline width is zero" };
  }
  const ring = parseColor(measurement.outlineColor);
  const surface = parseColor(measurement.cardBackground);
  if (!ring || !surface) {
    return {
      visible: false,
      ratio: null,
      why: `the colours could not be read (${measurement.outlineColor} on ${measurement.cardBackground})`,
    };
  }
  const ratio = contrastRatio(ring, surface);
  if (ratio < MINIMUM_CONTRAST) {
    return {
      visible: false,
      ratio,
      why: `the ring's contrast against the card is ${ratio.toFixed(2)}:1 — below the ${MINIMUM_CONTRAST}:1 minimum`,
    };
  }
  return {
    visible: true,
    ratio,
    why: `the ring's contrast against the card is ${ratio.toFixed(2)}:1 (${MINIMUM_CONTRAST}:1 met)`,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const findings = [];
  const pageErrors = [];

  for (const preset of PRESETS) {
    const context = await browser.newContext();
    // The SERVER resolves the preset from this cookie, so the first paint
    // already carries the theme under test.
    await context.addCookies([{ name: "aqua_theme", value: preset, url: BASE_URL }]);
    const page = await context.newPage();
    // Errors are REPORTED, never suppressed.
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(`${preset}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      pageErrors.push(`${preset}: ${String(error)}`);
    });

    await login(page);
    await openOwnerHome(page);
    const renderedPreset = await page.evaluate(
      () => document.documentElement.dataset.theme ?? null,
    );

    for (const target of TARGETS) {
      const presses = await focusWithKeyboard(page, target.selector);
      const measurement = presses > 0 ? await measureRing(page, target.selector) : null;
      const verdict = ringVerdict(measurement);
      const card = await page.$('[data-testid="owner-home-money-surface"]');
      const clip = card ? await card.boundingBox() : undefined;
      await page.screenshot({
        path: join(OUT_DIR, `${preset}-${target.key}-focus.png`),
        caret: "initial",
        ...(clip ? { clip } : {}),
      });
      findings.push({
        preset,
        renderedPreset,
        target: target.key,
        label: target.label,
        tabPresses: presses,
        ...(measurement ?? {}),
        ...verdict,
      });
    }
    await context.close();
  }

  await browser.close();
  writeFileSync(
    join(OUT_DIR, "findings.json"),
    JSON.stringify({ findings, pageErrors }, null, 2),
  );

  for (const finding of findings) {
    const state = finding.visible ? "VISIBLE" : "INVISIBLE";
    console.log(
      `${state}\t${finding.preset}\t${finding.target}\tcontrast=${
        finding.ratio === null || finding.ratio === undefined ? "-" : finding.ratio.toFixed(2) + ":1"
      } ring=${finding.outlineColor ?? "-"} surface=${finding.cardBackground ?? "-"} (${finding.why})`,
    );
  }
  if (pageErrors.length > 0) {
    console.log(`\nPage errors reported (not suppressed): ${pageErrors.length}`);
    for (const error of pageErrors) console.log(`  ${error}`);
  }
  const invisible = findings.filter((finding) => !finding.visible);
  console.log(
    `\n${findings.length - invisible.length}/${findings.length} rings visible. ` +
      `Screenshots and findings.json: ${OUT_DIR}`,
  );
  if (invisible.length > 0) {
    console.log(
      "A FOCUS RING FAILS THE CONTRAST CHECK — the correction to apply next is a " +
        "light ring on the dark hero (focus-visible:outline-[var(--owner-hero-ink)] " +
        "with a suitable outline-offset), not a change to the card surface.",
    );
    process.exitCode = 1;
  }
}

await main();
