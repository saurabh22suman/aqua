// The install ribbon's vertical geometry.
//
// Pure arithmetic, no DOM: the component measures the viewport and the
// ribbon, this file decides where the ribbon may sit. Keeping the
// numbers here makes the bounds testable without a browser and keeps
// the component free of scattered magic numbers.
//
// The band follows the shell (DESIGN.md §2):
//
//   * the top clearance is the sticky app chrome — the 56px shell
//     header plus whatever the demo banner published as
//     --app-sticky-offset;
//   * the bottom clearance is the 64px bottom-navigation gutter
//     (components/bottom-nav.tsx is min-h-16) plus the phone's home
//     indicator inset.
//
// The ribbon may only move inside that band, so it can never cover the
// navigation, the sticky header or the home indicator.

/** The sticky shell header's height (components/owner-shell.tsx is min-h-14). */
export const RIBBON_HEADER_CLEARANCE = 56;

/** The bottom navigation's height (components/bottom-nav.tsx is min-h-16). */
export const RIBBON_NAV_CLEARANCE = 64;

/** How far one arrow-key press moves the ribbon. */
export const RIBBON_KEY_STEP = 24;

/** The pointer travel, in px, that counts as a drag rather than a tap. */
export const RIBBON_DRAG_THRESHOLD = 4;

/**
 * The collapsed tab.
 *
 * The independent Chrome review of 30 October 2026 found the collapsed
 * ribbon as a column of floating tiles that covered the Members row
 * links. The collapsed ribbon is now ONE tab, and it keeps the shared
 * control contract's 44px target — WCAG's 24px minimum does not replace
 * that rule, and a narrower tab would be a silent downgrade of it.
 *
 * So the tab does not get narrower: it gets PLACED where it does not
 * cover anything. Where the page leaves a right gutter wide enough, the
 * tab sits inside that gutter and covers nothing at all. Where it does
 * not, the ribbon looks for a place in its band where its 44px square
 * overlaps no interactive control, and where there is no such place the
 * ribbon does not render: it never covers a row and never steals a
 * click.
 */
export const RIBBON_TILE_SIZE = 44;
/** The air kept between the tab and the content it must not cover. */
export const RIBBON_TILE_AIR = 4;

/** Can the page's right gutter host the tab without touching the content? */
export function ribbonFitsGutter(gutter: number): boolean {
  return gutter >= RIBBON_TILE_SIZE + RIBBON_TILE_AIR;
}

export type RibbonRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** The rectangle the tab occupies at a given place. */
export function ribbonTabRect(top: number, left: number, size: number): RibbonRect {
  return { left, top, right: left + size, bottom: top + size };
}

/** Does this rectangle touch any of these? */
export function overlapsAny(rect: RibbonRect, blockers: RibbonRect[]): boolean {
  return blockers.some(
    (blocker) =>
      blocker.right > rect.left &&
      blocker.left < rect.right &&
      blocker.bottom > rect.top &&
      blocker.top < rect.bottom,
  );
}

/** The candidate dock positions, the preferred one first, then outwards. */
export function ribbonCandidates(bounds: RibbonBounds, preferred: number, step = 8): number[] {
  const candidates = [preferred];
  const span = bounds.maxTop - bounds.minTop + step;
  for (let offset = step; offset <= span; offset += step) {
    const above = preferred - offset;
    const below = preferred + offset;
    if (above >= bounds.minTop) candidates.push(above);
    if (below <= bounds.maxTop) candidates.push(below);
  }
  // The very ends of the band are candidates too: the search must be
  // able to reach them, not only the steps between them.
  if (!candidates.includes(bounds.minTop)) candidates.push(bounds.minTop);
  if (!candidates.includes(bounds.maxTop)) candidates.push(bounds.maxTop);
  return candidates;
}

/**
 * The first candidate position whose 44px square overlaps no blocker, or
 * null when there is no clear place at all.
 */
export function ribbonClearTop(
  candidates: number[],
  tabLeft: number,
  tabSize: number,
  blockers: RibbonRect[],
): number | null {
  for (const top of candidates) {
    if (!overlapsAny(ribbonTabRect(top, tabLeft, tabSize), blockers)) return top;
  }
  return null;
}


export type RibbonBounds = {
  /** The smallest allowed top offset, in px. */
  minTop: number;
  /** The largest allowed top offset, in px. */
  maxTop: number;
};

export type RibbonBoundsInput = {
  /** The height of the visible viewport. */
  viewportHeight: number;
  /** The height the ribbon needs where it sits. */
  ribbonHeight: number;
  /** The sticky chrome above the ribbon. */
  headerClearance?: number;
  /** The home indicator inset below the navigation. */
  safeAreaBottom?: number;
};

/** The band the ribbon may move in. */
export function ribbonBounds(input: RibbonBoundsInput): RibbonBounds {
  const minTop = Math.max(0, input.headerClearance ?? RIBBON_HEADER_CLEARANCE);
  const maxTop = Math.max(
    minTop,
    input.viewportHeight -
      RIBBON_NAV_CLEARANCE -
      (input.safeAreaBottom ?? 0) -
      Math.max(0, input.ribbonHeight),
  );
  return { minTop, maxTop };
}

/** Keep a top offset inside the band. */
export function clampRibbonTop(top: number, bounds: RibbonBounds): number {
  if (!Number.isFinite(top)) return bounds.minTop;
  return Math.min(Math.max(top, bounds.minTop), bounds.maxTop);
}

/** The three bounded stops: the top, the middle and the bottom. */
export function ribbonStops(bounds: RibbonBounds): [number, number, number] {
  const middle = bounds.minTop + (bounds.maxTop - bounds.minTop) / 2;
  return [bounds.minTop, middle, bounds.maxTop];
}

/**
 * The stop after the current position. It cycles, so a person can move
 * the ribbon with a single tap and never needs to drag it at all.
 */
export function nextRibbonStop(top: number, bounds: RibbonBounds): number {
  const stops = ribbonStops(bounds);
  const epsilon = 2;
  const index = stops.findIndex((stop) => Math.abs(stop - top) <= epsilon);
  if (index === -1) {
    // Between two stops: fall back to the nearest stop at or above.
    const above = stops.filter((stop) => stop <= top + epsilon);
    return above.length > 0 ? above[above.length - 1] : stops[0];
  }
  return stops[(index + 1) % stops.length];
}

/** One keyboard step, clamped to the band. */
export function stepRibbonTop(top: number, delta: number, bounds: RibbonBounds): number {
  return clampRibbonTop(top + delta, bounds);
}

/** Where a drag puts the ribbon: the pointer's travel, clamped. */
export function dragRibbonTop(
  startTop: number,
  startY: number,
  currentY: number,
  bounds: RibbonBounds,
): number {
  return clampRibbonTop(startTop + (currentY - startY), bounds);
}
