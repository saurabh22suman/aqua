// Ops redesign (28 October 2026) — the shell geometry regression.
//
// Real Chrome, real rendering, real measurements. This is the proof
// the shell's own rules claim:
//
//   - the rail is painted with the PRESET's light sidebar surface
//     (Mint Garden pale mint, Lavender Club pale lilac) — never the
//     old dark marine column;
//   - the rail is VIEWPORT-BOUND: it never grows past the window, and
//     the document is the one vertical scroll owner;
//   - ONLY the navigation region scrolls inside the rail, so the brand
//     and the exit control stay reachable on a short screen;
//   - after a long page is scrolled to the bottom, the rail, its brand
//     and its exit control are still on screen.
//
// Every assertion reads a computed style or a bounding box. None of
// them reads a class string.
//
// Run inside the bounded preview:
//   python3 .opencode/scripts/lane_job.py exec python3 .opencode/scripts/preview_job.py \
//     --port 3187 -- pnpm exec tsx e2e/ops-redesign/ops-shell-geometry.ts

import assert from "node:assert/strict";
import { readFixture, signIn } from "./ops-fixture";
import {
  cssVariable,
  makeChecker,
  measure,
  openConsole,
} from "./ops-browser";

function relativeLuminance(rgb: string): number {
  const parts = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  const [r, g, b] = parts.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Normalise a colour to "r, g, b" so a CSS token (which resolves to a
 * hex literal) can be compared with a computed background (which
 * resolves to rgb()). A hex token and an rgb() computed value are the
 * same colour; comparing the strings would only prove that two
 * notations differ.
 */
function toRgbTriplet(colour: string): string {
  const trimmed = colour.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((c) => c + c)
            .join("")
        : hex;
    const value = parseInt(full.slice(0, 6), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `${r}, ${g}, ${b}`;
  }
  const parts = trimmed.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return `${parts[0]}, ${parts[1]}, ${parts[2]}`;
}

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;

  try {
    await signIn(page, base, fixture.operator);

    await checker.check(
      "the rail is painted with the preset's light sidebar surface",
      async () => {
        const rail = await measure(page, '[data-testid="ops-sidebar"]');
        assert.ok(rail, "the rail was not rendered");
        const token = await cssVariable(page, "--surface-sidebar");
        const probe = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="ops-sidebar"]');
          if (!el) return null;
          const style = getComputedStyle(el);
          return style.backgroundColor;
        });
        assert.ok(probe, "the rail has no computed background");
        assert.equal(
          toRgbTriplet(probe),
          toRgbTriplet(token),
          `the rail background ${probe} does not match --surface-sidebar ${token}`,
        );
        assert.ok(
          relativeLuminance(toRgbTriplet(probe)) > 0.6,
          `the rail is not a light surface: ${probe} (luminance ${relativeLuminance(toRgbTriplet(probe))})`,
        );
      },
    );

    await checker.check(
      "the rail is viewport-bound and is not itself a scroller",
      async () => {
        const rail = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="ops-sidebar"]');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return {
            height: rect.height,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            overflowY: style.overflowY,
          };
        });
        assert.ok(rail, "the rail was not rendered");
        assert.ok(
          rail.height <= 900 + 1,
          `the rail grew past the viewport: ${rail.height}px`,
        );
        assert.equal(rail.overflowY, "hidden", "the rail itself scrolls");
        assert.ok(
          rail.scrollHeight <= rail.clientHeight + 1,
          `the rail's content overflows it (${rail.scrollHeight} > ${rail.clientHeight}); the navigation region should be the scroller`,
        );
      },
    );

    await checker.check(
      "the navigation region is the only inner scroller in the rail",
      async () => {
        const nav = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="ops-side-nav-scroll"]');
          if (!el) return null;
          return {
            overflowY: getComputedStyle(el).overflowY,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          };
        });
        assert.ok(nav, "the navigation region was not rendered");
        assert.equal(
          nav.overflowY,
          "auto",
          "the navigation region is not the scroller",
        );
        assert.ok(
          nav.scrollHeight >= nav.clientHeight,
          "the navigation region reports no content at all",
        );
      },
    );

    await checker.check(
      "the document is the single vertical scroll owner on a long page",
      async () => {
        await page.goto(`${base}/ops/tenants/${fixture.tenantId}/configuration`);
        await page.getByRole("heading", { level: 1 }).first().waitFor();
        const owners = await page.evaluate(() => {
          const scrolling = document.scrollingElement;
          return {
            documentScrolls:
              !!scrolling && scrolling.scrollHeight > scrolling.clientHeight + 1,
            innerScrollers: Array.from(
              document.querySelectorAll<HTMLElement>("body *"),
            ).filter((el) => {
              const style = getComputedStyle(el);
              if (style.overflowY !== "auto" && style.overflowY !== "scroll") {
                return false;
              }
              return el.scrollHeight > el.clientHeight + 1;
            }).length,
          };
        });
        assert.equal(
          owners.documentScrolls,
          true,
          "the document does not scroll — there is no page scroll owner",
        );
        assert.equal(
          owners.innerScrollers,
          0,
          "another element scrolls the content as well — the page has two vertical scroll owners",
        );
      },
    );

    await checker.check(
      "after scrolling a long page to the bottom, the rail, brand and exit control are still on screen",
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(250);
        const state = await page.evaluate(() => {
          const rail = document.querySelector('[data-testid="ops-sidebar"]');
          const brand = document.querySelector('[data-testid="ops-shell-brand"]');
          const account = document.querySelector('[data-testid="ops-shell-account"]');
          const signOut = account ? account.querySelector("button") : null;
          return {
            rail: rail ? rail.getBoundingClientRect().toJSON() : null,
            brand: brand ? brand.getBoundingClientRect().toJSON() : null,
            account: account ? account.getBoundingClientRect().toJSON() : null,
            signOut: signOut ? signOut.getBoundingClientRect().toJSON() : null,
            viewport: window.innerHeight,
            scrollY: window.scrollY,
          };
        });
        assert.ok(state.rail && state.brand && state.account && state.signOut);
        assert.ok(
          Math.abs(state.rail.top) <= 1,
          `the rail moved with the page: top ${state.rail.top}`,
        );
        assert.ok(
          state.rail.bottom <= state.viewport + 1,
          `the rail extends past the viewport: ${state.rail.bottom} > ${state.viewport}`,
        );
        assert.ok(
          state.brand.bottom <= state.viewport && state.brand.top >= -1,
          "the brand scrolled out of view",
        );
        assert.ok(
          state.account.bottom <= state.viewport + 1 && state.account.top >= 0,
          "the exit control is no longer reachable",
        );
        assert.ok(
          state.signOut.height >= 44,
          `the exit control is ${state.signOut.height}px tall — below the 44px floor`,
        );
        await page.screenshot({
          path: `${process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028"}/shell-configuration-bottom-1280.png`,
        });
      },
    );

    await checker.check(
      "the navigation rows are at least 44px tall and show the active destination",
      async () => {
        const rows = await page.evaluate(() => {
          const nav = document.querySelector('[data-testid="ops-side-nav-scroll"]');
          if (!nav) return [];
          return Array.from(nav.querySelectorAll("a")).map((a) => ({
            href: a.getAttribute("href"),
            height: a.getBoundingClientRect().height,
            current: a.getAttribute("aria-current"),
          }));
        });
        assert.ok(rows.length > 0, "the navigation rendered no rows");
        for (const row of rows) {
          assert.ok(
            row.height >= 44,
            `the ${row.href} row is ${row.height}px tall — below the 44px floor`,
          );
        }
        const active = rows.filter((row) => row.current === "page");
        assert.equal(
          active.length,
          1,
          `expected exactly one active destination, found ${active.length}`,
        );
      },
    );

    await checker.check(
      "the phone bar's Menu reveals the destinations the bottom bar cannot carry",
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${base}/ops`);
        await page.waitForTimeout(250);
        const toggle = page.getByRole("button", { name: "Menu" });
        await toggle.waitFor();
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        await toggle.click();
        await page.waitForTimeout(150);
        assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        const menu = page.getByRole("navigation", { name: "Platform menu" });
        await menu.waitFor({ state: "visible" });
        const links = await menu.getByRole("link").all();
        const hrefs = [];
        for (const link of links) hrefs.push(await link.getAttribute("href"));
        assert.equal(
          hrefs.length,
          7,
          `the phone Menu should carry all seven destinations, found ${hrefs.length}`,
        );
        await page.screenshot({
          path: `${process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028"}/shell-phone-menu-390.png`,
        });
      },
    );

    await checker.check(
      "the Lavender Club preset repaints the rail in its own light surface",
      async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.context().addCookies([
          {
            name: "aqua_theme",
            value: "lavender",
            url: base,
          },
        ]);
        await page.goto(`${base}/ops`);
        await page.waitForTimeout(250);
        const rail = await measure(page, '[data-testid="ops-sidebar"]');
        const token = await cssVariable(page, "--surface-sidebar");
        assert.ok(rail, "the rail was not rendered");
        assert.equal(
          toRgbTriplet(rail.backgroundColor),
          toRgbTriplet(token),
          `the rail background ${rail.backgroundColor} does not match the lavender --surface-sidebar ${token}`,
        );
        assert.ok(
          relativeLuminance(toRgbTriplet(rail.backgroundColor)) > 0.6,
          `the lavender rail is not a light surface: ${rail.backgroundColor}`,
        );
        await page.screenshot({
          path: `${process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028"}/shell-lavender-1280.png`,
        });
      },
    );

    await checker.check(
      "no page scrolls sideways at the desktop width",
      async () => {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        );
        assert.equal(overflow, true, "the page scrolls horizontally");
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await checker.writeResults("ops-shell-geometry.json");
  }

  if (checker.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("The Ops shell geometry check could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
