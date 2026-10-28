// Ops redesign (28 October 2026) — the Ops console at a REAL native
// 200% browser zoom.
//
// The zoom is the BROWSER'S OWN, applied through the Chrome settings
// API (`chrome.settingsPrivate.setDefaultZoom(2)`) in a DISPOSABLE
// Chrome profile — not a CSS scale, not a device-scale-factor proxy and
// not a reflow proxy. The proof is measured, not assumed:
//
//   - the default zoom reads back as 2;
//   - the CSS viewport HALVES (a 1280-wide window lays out at 640 CSS
//     pixels) — a scaled picture would not reflow at all;
//   - the device pixel ratio DOUBLES (the page is painted at twice the
//     device resolution);
//   - the OUTER window is unchanged (the same physical window);
//   - the visual viewport scale stays 1 (this is not a pinch zoom).
//
// The chrome://settings page is opened in THAT disposable Chrome only.
// No human browser, profile, cookie or offline data is touched, and
// the Ops fixture operator is a disposable one of this check's own.
//
// The screens checked are the Overview, the long Tenants list, the
// Activity log and the new-tenant editor, in BOTH approved presets.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-native-zoom.ts

import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import {
  markTotpEnrolled,
  provisionPlatformUser,
} from "@/db/platform-auth";
import { privilegedFixturePool } from "../../tests/db/privileged-fixture";
import { makeChecker } from "./ops-browser";

const OUT =
  process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028";

/**
 * The slice of the chrome://settings Private API this check uses.
 *
 * An index signature rather than a named member: the lint rule reads a
 * type member called "chrome" as an unused variable.
 */
type ChromeSettingsApi = {
  [member: string]: {
    settingsPrivate: {
      setDefaultZoom(level: number, callback: () => void): void;
      getDefaultZoom(callback: (level: number) => void): void;
    };
    runtime: { lastError?: { message: string } };
  };
};

type Facts = {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  dpr: number;
  scale: number;
  overflow: number;
  pageHeight: number;
  theme: string | null;
  rail: { top: number; bottom: number; height: number } | null;
  railVisible: boolean;
  phoneHeader: { top: number; bottom: number } | null;
  phoneHeaderVisible: boolean;
  signOutVisible: boolean;
  firstHeading: { top: number; bottom: number } | null;
  coveredByChrome: boolean;
};

async function facts(page: Page): Promise<Facts> {
  return await page.evaluate(() => {
    // NO inner function is assigned to a const inside this evaluate:
    // the esbuild transform wraps such an assignment with a `__name`
    // helper that does not exist in the page, and the evaluate dies
    // with "__name is not defined". Every fact is read inline.
    const railElement = document.querySelector('[data-testid="ops-sidebar"]');
    const phoneElement = document.querySelector(
      '[data-testid="platform-mobile-header"]',
    );
    const headingElement = document.querySelector("main h1");
    const signOutElement = phoneElement
      ? phoneElement.querySelector("button")
      : null;
    const railRect = railElement
      ? railElement.getBoundingClientRect()
      : null;
    const phoneRect = phoneElement ? phoneElement.getBoundingClientRect() : null;
    const headingRect = headingElement
      ? headingElement.getBoundingClientRect()
      : null;
    const signOutRect = signOutElement
      ? signOutElement.getBoundingClientRect()
      : null;
    const railStyle = railElement ? getComputedStyle(railElement) : null;
    const phoneStyle = phoneElement ? getComputedStyle(phoneElement) : null;
    return {
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      dpr: devicePixelRatio,
      scale: visualViewport?.scale ?? 1,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageHeight: document.documentElement.scrollHeight,
      theme: document.documentElement.dataset.theme ?? null,
      rail: railRect
        ? {
            top: railRect.top,
            bottom: railRect.bottom,
            height: railRect.height,
            width: railRect.width,
          }
        : null,
      railVisible:
        !!railRect &&
        railRect.width > 0 &&
        railRect.height > 0 &&
        railStyle?.display !== "none" &&
        railStyle?.visibility !== "hidden",
      phoneHeader: phoneRect
        ? { top: phoneRect.top, bottom: phoneRect.bottom }
        : null,
      phoneHeaderVisible:
        !!phoneRect &&
        phoneRect.width > 0 &&
        phoneRect.height > 0 &&
        phoneStyle?.display !== "none" &&
        phoneStyle?.visibility !== "hidden",
      signOutVisible:
        !!signOutRect &&
        signOutRect.width > 0 &&
        signOutRect.height > 0,
      firstHeading: headingRect
        ? { top: headingRect.top, bottom: headingRect.bottom }
        : null,
      // A heading that has scrolled ABOVE the viewport is not
      // covered — it is simply out of view. A heading is COVERED when
      // the sticky phone bar overlaps it.
      coveredByChrome:
        !!headingRect &&
        !!phoneRect &&
        headingRect.bottom > phoneRect.top &&
        headingRect.top < phoneRect.bottom,
    };
  });
}

async function signIn(page: Page, base: string, operator: { email: string; password: string; totpSecret: string }) {
  await page.goto(`${base}/ops/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(operator.email);
  await page.getByLabel("Password", { exact: true }).fill(operator.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/ops/verify");
  const { currentTotpCode } = await import("@/db/platform-auth");
  await page
    .getByLabel("6-digit code", { exact: true })
    .fill(currentTotpCode(operator.totpSecret));
  await page.waitForURL(`${base}/ops`);
}

async function main() {
  const checker = makeChecker();
  const local = new URL(process.env.AQUA_E2E_BASE_URL ?? "http://invalid");
  if (local.hostname !== "127.0.0.1") {
    throw new Error("The Ops preview must be served on 127.0.0.1.");
  }
  const base = `http://ops.localhost:${local.port}`;

  // A DISPOSABLE operator per theme, of this check's own (the fixture
  // operator may be inside the platform's sign-in rate limit, and this
  // check is about the zoom, not about the fixture's identity). A fresh
  // operator per theme is also what the authenticator's REPLAY guard
  // requires: a one-time code cannot be used twice.
  const createdIds: string[] = [];

  mkdirSync(OUT, { recursive: true });

  try {
    for (const theme of ["mint", "lavender"] as const) {
      const email = `native-zoom-${randomUUID()}@example.test`;
      const password = `Synthetic-${randomUUID()}`;
      const created = await provisionPlatformUser({
        email,
        password,
        name: "Native zoom check",
        role: "admin",
      });
      await markTotpEnrolled(created.id);
      createdIds.push(created.id);
      const operator = {
        email,
        password,
        totpSecret: created.totpSecret,
      };
      const profile = join(OUT, `native-zoom-profile-${theme}-${randomUUID().slice(0, 6)}`);
      mkdirSync(profile, { recursive: true });
      const context = await chromium.launchPersistentContext(profile, {
        channel: "chrome",
        headless: true,
        viewport: null,
        args: ["--window-size=1280,987"],
        timezoneId: "Asia/Kolkata",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await signIn(page, base, operator);
        await context.addCookies([{ name: "aqua_theme", value: theme, url: base }]);

        // ── The native zoom, applied by the browser itself ──────────
        await page.goto(`${base}/ops`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(300);
        const normal = await facts(page);

        const settings = await context.newPage();
        await settings.goto("chrome://settings/appearance");
        const readback = await settings.evaluate(async () => {
          // The chrome://settings Private API, typed locally so the
          // script needs no ambient global declaration.
          const api = (globalThis as unknown as ChromeSettingsApi).chrome;
          await new Promise<void>((resolve, reject) => {
            api.settingsPrivate.setDefaultZoom(2, () =>
              api.runtime.lastError
                ? reject(Error(api.runtime.lastError.message))
                : resolve(),
            );
          });
          return await new Promise<number>((resolve) =>
            api.settingsPrivate.getDefaultZoom(resolve),
          );
        });
        await settings.close();

        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(400);
        const zoomed = await facts(page);

        await checker.check(
          `${theme}: the browser's OWN zoom is at 200% (not a scale or a proxy)`,
          async () => {
            assert.equal(readback, 2, "the browser's default zoom did not read back as 2");
            assert.ok(
              Math.abs(normal.innerWidth / zoomed.innerWidth - 2) < 0.02,
              `the CSS viewport did not halve (${normal.innerWidth} -> ${zoomed.innerWidth}) — this is not a browser zoom`,
            );
            assert.ok(
              Math.abs(zoomed.dpr / normal.dpr - 2) < 0.02,
              `the device pixel ratio did not double (${normal.dpr} -> ${zoomed.dpr})`,
            );
            assert.equal(
              zoomed.outerWidth,
              normal.outerWidth,
              "the physical window changed — this is not a zoom of the same window",
            );
            assert.equal(zoomed.scale, 1, "the visual viewport is scaled — that is a pinch zoom, not a browser zoom");
          },
        );

        // ── The console's screens at that zoom ─────────────────────
        for (const route of [
          "/ops",
          "/ops/tenants",
          "/ops/activity",
          "/ops/tenants/new",
        ]) {
          await checker.check(
            `${theme}: ${route} at a native 200% zoom has no sideways scroll and no covered control`,
            async () => {
              await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" });
              await page.waitForTimeout(400);
              const f = await facts(page);
              assert.ok(
                f.overflow <= 1,
                `${route} scrolls sideways at a native 200% zoom (${f.overflow}px)`,
              );
              assert.equal(
                f.coveredByChrome,
                false,
                `${route}: the page heading is covered by the app chrome`,
              );
              // At a 640 CSS-pixel layout the console is on its PHONE
              // shell, so the exit control lives in the phone bar.
              assert.equal(
                f.railVisible,
                false,
                `${route}: the desktop rail is still shown at a 640px layout`,
              );
              assert.equal(
                f.phoneHeaderVisible,
                true,
                `${route}: the phone bar is missing at a 640px layout`,
              );
              assert.equal(
                f.signOutVisible,
                true,
                `${route}: the exit control is not reachable at a 640px layout`,
              );
              await page.screenshot({
                path: `${OUT}/native-200-${theme}-${route.replace(/\//g, "-")}.png`,
              });
            },
          );
        }

        // ── The long page scrolls, and the exit stays reachable ────
        await checker.check(
          `${theme}: the long Tenants list scrolls at a native 200% zoom, with the exit reachable`,
          async () => {
            await page.goto(`${base}/ops/tenants`, {
              waitUntil: "domcontentloaded",
            });
            await page.waitForTimeout(400);
            const initial = await facts(page);
            assert.ok(
              initial.pageHeight > initial.innerHeight + 50,
              "the tenants list is not a long page",
            );
            for (const [name, fraction] of [
              ["top", 0],
              ["middle", 0.5],
              ["bottom", 1],
            ] as const) {
              await page.evaluate((f) => {
                window.scrollTo(
                  0,
                  (document.documentElement.scrollHeight - innerHeight) * f,
                );
              }, fraction);
              await page.waitForTimeout(200);
              const f = await facts(page);
              assert.ok(f.overflow <= 1, `${name}: the page scrolls sideways`);
              assert.equal(
                f.coveredByChrome,
                false,
                `${name}: the heading is covered by the app chrome`,
              );
              assert.equal(
                f.signOutVisible,
                true,
                `${name}: the exit control is not reachable`,
              );
              await page.screenshot({
                path: `${OUT}/native-200-${theme}-tenants-${name}.png`,
              });
            }
          },
        );
      } finally {
        await context.close().catch(() => undefined);
        rmSync(profile, { recursive: true, force: true });
      }
    }
  } finally {
    await checker.writeResults("ops-native-zoom.json");
    for (const id of createdIds) {
      await privilegedFixturePool
        .query("delete from platform_users where id = $1", [id])
        .catch(() => undefined);
    }
    await privilegedFixturePool.end().catch(() => undefined);
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops native-zoom check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
