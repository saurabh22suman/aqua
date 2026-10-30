import { describe, expect, it } from "vitest";
import {
  RIBBON_HEADER_CLEARANCE,
  RIBBON_KEY_STEP,
  RIBBON_NAV_CLEARANCE,
  RIBBON_TILE_AIR,
  RIBBON_TILE_SIZE,
  clampRibbonTop,
  dragRibbonTop,
  nextRibbonStop,
  ribbonBounds,
  ribbonCandidates,
  ribbonClearTop,
  ribbonFitsGutter,
  ribbonStops,
  stepRibbonTop,
} from "@/components/pwa/install-ribbon-geometry";

// The install ribbon's vertical arithmetic (the pure half of
// components/pwa/install-ribbon-geometry.ts).
//
// These are the numbers that keep the ribbon clear of the sticky
// header, the bottom navigation and the phone's home indicator, so they
// are worth pinning down without a browser.
//
// Agent-owned file (tests/pwa/ribbon-20261030/**).

const VIEWPORT = 844;
const RIBBON = 96;

describe("the ribbon's band", () => {
  it("clears the sticky header above and the navigation below", () => {
    const bounds = ribbonBounds({ viewportHeight: VIEWPORT, ribbonHeight: RIBBON });

    expect(bounds.minTop).toBe(RIBBON_HEADER_CLEARANCE);
    expect(bounds.maxTop).toBe(VIEWPORT - RIBBON_NAV_CLEARANCE - RIBBON);
  });

  it("keeps clear of the home indicator as well", () => {
    const bounds = ribbonBounds({
      viewportHeight: VIEWPORT,
      ribbonHeight: RIBBON,
      safeAreaBottom: 34,
    });

    expect(bounds.maxTop).toBe(VIEWPORT - RIBBON_NAV_CLEARANCE - 34 - RIBBON);
  });

  it("counts the demo banner that published its own offset", () => {
    const bounds = ribbonBounds({
      viewportHeight: VIEWPORT,
      ribbonHeight: RIBBON,
      headerClearance: RIBBON_HEADER_CLEARANCE + 44,
    });

    expect(bounds.minTop).toBe(RIBBON_HEADER_CLEARANCE + 44);
  });

  it("never folds the band over itself on a short screen", () => {
    const bounds = ribbonBounds({ viewportHeight: 200, ribbonHeight: RIBBON });

    expect(bounds.maxTop).toBeGreaterThanOrEqual(bounds.minTop);
  });
});

describe("the collapsed tab's placement", () => {
  const bounds = ribbonBounds({ viewportHeight: VIEWPORT, ribbonHeight: RIBBON });

  it("keeps the shared control contract's 44px target", () => {
    // WCAG's 24px minimum does not replace the 44px control rule.
    expect(RIBBON_TILE_SIZE).toBe(44);
  });

  it("fits in the page's gutter only when the gutter can hold it", () => {
    // The desktop owner shell leaves 32px of shell padding plus the
    // page's own 20px: the tab fits with air to spare.
    expect(ribbonFitsGutter(RIBBON_TILE_SIZE + RIBBON_TILE_AIR)).toBe(true);
    expect(ribbonFitsGutter(RIBBON_TILE_SIZE + RIBBON_TILE_AIR - 1)).toBe(false);
    expect(ribbonFitsGutter(20)).toBe(false);
  });

  it("prefers the chosen position and then looks outwards", () => {
    const preferred = ribbonStops(bounds)[1];
    const candidates = ribbonCandidates(bounds, preferred, 8);

    expect(candidates[0]).toBe(preferred);
    expect(candidates).toContain(bounds.minTop);
    expect(candidates).toContain(bounds.maxTop);
    expect(candidates.every((top) => top >= bounds.minTop && top <= bounds.maxTop)).toBe(true);
  });

  it("finds a place that overlaps no control, and gives up when there is none", () => {
    const blockers = [{ left: 300, top: 100, right: 390, bottom: 200 }];

    expect(ribbonClearTop([150, 250], 346, RIBBON_TILE_SIZE, blockers)).toBe(250);
    expect(ribbonClearTop([150], 346, RIBBON_TILE_SIZE, blockers)).toBeNull();
    expect(ribbonClearTop([250], 346, RIBBON_TILE_SIZE, blockers)).toBe(250);
  });
});

describe("placing the ribbon", () => {
  const bounds = ribbonBounds({ viewportHeight: VIEWPORT, ribbonHeight: RIBBON });

  it("clamps a position into the band", () => {
    expect(clampRibbonTop(-40, bounds)).toBe(bounds.minTop);
    expect(clampRibbonTop(5000, bounds)).toBe(bounds.maxTop);
    expect(clampRibbonTop(300, bounds)).toBe(300);
    expect(clampRibbonTop(Number.NaN, bounds)).toBe(bounds.minTop);
  });

  it("offers three bounded stops", () => {
    const stops = ribbonStops(bounds);

    expect(stops).toHaveLength(3);
    expect(stops[0]).toBe(bounds.minTop);
    expect(stops[2]).toBe(bounds.maxTop);
    expect(stops[1]).toBe((bounds.minTop + bounds.maxTop) / 2);
  });

  it("cycles the stops so a tap is enough to move the ribbon", () => {
    const stops = ribbonStops(bounds);

    expect(nextRibbonStop(stops[0], bounds)).toBe(stops[1]);
    expect(nextRibbonStop(stops[1], bounds)).toBe(stops[2]);
    expect(nextRibbonStop(stops[2], bounds)).toBe(stops[0]);
  });

  it("falls back to the nearest stop when the ribbon sits between two", () => {
    const stops = ribbonStops(bounds);

    expect(nextRibbonStop(stops[1] + 10, bounds)).toBe(stops[1]);
    expect(nextRibbonStop(stops[0] - 30, bounds)).toBe(stops[0]);
  });

  it("moves one keyboard step at a time", () => {
    const middle = ribbonStops(bounds)[1];

    expect(stepRibbonTop(middle, -RIBBON_KEY_STEP, bounds)).toBe(middle - RIBBON_KEY_STEP);
    expect(stepRibbonTop(middle, RIBBON_KEY_STEP, bounds)).toBe(middle + RIBBON_KEY_STEP);
    expect(stepRibbonTop(bounds.minTop, -RIBBON_KEY_STEP, bounds)).toBe(bounds.minTop);
  });

  it("follows the pointer during a drag and stays inside the band", () => {
    const middle = ribbonStops(bounds)[1];

    expect(dragRibbonTop(middle, 400, 300, bounds)).toBe(middle - 100);
    expect(dragRibbonTop(middle, 400, 5000, bounds)).toBe(bounds.maxTop);
    expect(dragRibbonTop(middle, 400, -5000, bounds)).toBe(bounds.minTop);
  });
});
