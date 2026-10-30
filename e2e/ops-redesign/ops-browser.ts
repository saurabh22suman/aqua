// Ops redesign (28 October 2026) — the real-Chrome harness.
//
// The builder's own browser pass runs in an ISOLATED, NON-PERSISTENT
// Chrome profile (channel "chrome"), against the bounded preview
// server, with the synthetic fixture operator. Nothing here touches
// the human's browser profile, their offline data or their server.
//
// The console is served on the platform host, so every navigation uses
// `ops.localhost` and the resolver rule maps it to the loopback
// address — the same rule the reviewed security browser check uses.

import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export const OUT_DIR =
  process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028";

export type BrowserSession = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  base: string;
};

/** The console's origin for this run (the platform host, loopback-mapped). */
export function consoleBase(): string {
  const local = new URL(process.env.AQUA_E2E_BASE_URL ?? "http://invalid");
  if (local.hostname !== "127.0.0.1") {
    throw new Error("The Ops preview must be served on 127.0.0.1.");
  }
  return `http://ops.localhost:${local.port}`;
}

/** Open an isolated Chrome session against the console. */
export async function openConsole(
  viewport: { width: number; height: number } = { width: 1280, height: 900 },
): Promise<BrowserSession> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--host-resolver-rules=MAP ops.localhost 127.0.0.1"],
  });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return { browser, context, page, base: consoleBase() };
}

/** The computed box of the first match, or null. */
export type Box = {
  height: number;
  width: number;
  top: number;
  left: number;
  bottom: number;
  right: number;
  borderRadius: string;
  fontSize: string;
  backgroundColor: string;
  color: string;
  overflowY: string;
  overflowX: string;
  borderTopWidth: string;
  borderTopColor: string;
  paddingLeft: string;
  paddingRight: string;
  minHeight: string;
  textAlign: string;
};

/**
 * Read the real computed geometry and colour of a control.
 *
 * This is the point of the exercise: a class string is not a
 * measurement. Every number below comes from getComputedStyle /
 * getBoundingClientRect in the rendered page.
 */
export async function measure(page: Page, selector: string): Promise<Box | null> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      height: rect.height,
      width: rect.width,
      top: rect.top,
      left: rect.left,
      bottom: rect.bottom,
      right: rect.right,
      borderRadius: style.borderTopLeftRadius,
      fontSize: style.fontSize,
      backgroundColor: style.backgroundColor,
      color: style.color,
      overflowY: style.overflowY,
      overflowX: style.overflowX,
      borderTopWidth: style.borderTopWidth,
      borderTopColor: style.borderTopColor,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      minHeight: style.minHeight,
      textAlign: style.textAlign,
    };
  }, selector);
}

/**
 * Measure a control INSIDE the form that owns a marker control.
 *
 * The console's rail carries its own sign-out form, and it comes first
 * in the document — so a bare `form button[type="submit"]` measures
 * the rail's button, not the page's. Scoping through a marker that
 * lives in the form under test removes that ambiguity.
 */
export async function measureInForm(
  page: Page,
  markerSelector: string,
  controlSelector: string,
): Promise<Box | null> {
  return await page.evaluate(
    ([marker, control]) => {
      const markerEl = document.querySelector(marker);
      if (!markerEl) return null;
      const form = markerEl.closest("form");
      if (!form) return null;
      const el = form.querySelector(control);
      if (!el) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        borderRadius: style.borderTopLeftRadius,
        fontSize: style.fontSize,
        backgroundColor: style.backgroundColor,
        color: style.color,
        overflowY: style.overflowY,
        overflowX: style.overflowX,
        borderTopWidth: style.borderTopWidth,
        borderTopColor: style.borderTopColor,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
        minHeight: style.minHeight,
        textAlign: style.textAlign,
      };
    },
    [markerSelector, controlSelector] as const,
  );
}

/** The resolved value of a CSS custom property on the document root. */
export async function cssVariable(page: Page, name: string): Promise<string> {
  return await page.evaluate(
    (variable) =>
      getComputedStyle(document.documentElement)
        .getPropertyValue(variable)
        .trim(),
    name,
  );
}

/** A small, readable summary of one failed assertion. */
export type Check = { name: string; status: "PASS" | "FAIL"; detail?: string };

export function makeChecker() {
  const checks: Check[] = [];
  return {
    checks,
    async check(name: string, run: () => Promise<void>) {
      try {
        await run();
        checks.push({ name, status: "PASS" });
        console.log(`PASS ${name}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        checks.push({ name, status: "FAIL", detail });
        console.log(`FAIL ${name} — ${detail}`);
      }
    },
    async writeResults(file: string) {
      await mkdir(OUT_DIR, { recursive: true });
      await writeFile(
        `${OUT_DIR}/${file}`,
        JSON.stringify({ browser: "Chrome", checks }, null, 2),
      );
    },
    get failed() {
      return checks.some((check) => check.status === "FAIL");
    },
  };
}

/** Assert a numeric measurement with a tolerance, with a readable message. */
export function assertClose(
  actual: number,
  expected: number,
  tolerance: number,
  label: string,
) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(
      `${label}: expected ${expected}px (±${tolerance}), measured ${actual}px`,
    );
  }
}

/** Assert a measurement is at least the given height. */
export function assertAtLeast(actual: number, minimum: number, label: string) {
  if (actual < minimum - 0.5) {
    throw new Error(
      `${label}: expected at least ${minimum}px, measured ${actual}px`,
    );
  }
}
