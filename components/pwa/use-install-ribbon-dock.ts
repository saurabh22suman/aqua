"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  RIBBON_TILE_SIZE,
  clampRibbonTop,
  overlapsAny,
  ribbonCandidates,
  ribbonClearTop,
  ribbonFitsGutter,
  ribbonStops,
  ribbonTabRect,
  type RibbonBounds,
  type RibbonRect,
} from "./install-ribbon-geometry";
import { contentGutter, contentRects, viewportWidth } from "./install-ribbon-measure";

// Where the collapsed tab may sit.
//
// The tab keeps the shared control contract's 44px target — WCAG's 24px
// minimum does not replace that rule — so it does not get narrower to
// fit a tight page. It gets PLACED where it covers nothing:
//
//   * "gutter" — inside the page's own right gutter, when the gutter can
//     hold the 44px tab. Nothing is covered, on any scroll position.
//   * "clear"  — in a place confirmed clear of every control and every
//     piece of text on the page.
//   * "none"   — nowhere. The ribbon then does not render at all: a
//     ribbon that covers a row, or that steals a row's click, is worse
//     than no ribbon.
//
// The tab's hit area is exactly the visible 44px square. There is no
// invisible extension, so it can never take a click that belongs to the
// page.
//
// Three things move under a fixed ribbon, and the place is checked again
// for all of them:
//
//   * the PAGE scrolls (the document or any scrollable region);
//   * the page's CONTENT arrives late (a row, a label);
//   * the PERSON drags the ribbon somewhere new.
//
// So the check is never only the preferred middle: it is the ACTUAL
// position the ribbon is at, and it runs again whenever any of those
// three happen:
//
//   * the FIRST placement looks for a clear place in the band;
//   * while the person drags, the ribbon follows the pointer but stops
//     at the nearest clear place, so a drop can never land on a
//     control;
//   * when the page moves under the ribbon, the ribbon steps aside
//     rather than jumping around, and returns when the place is clear
//     again.

export type InstallRibbonDock = "gutter" | "clear" | "none" | "unknown";

/** How long to wait after a scroll or a DOM change before re-checking. */
export const RIBBON_RECHECK_MS = 150;

export type UseInstallRibbonDockOptions = {
  rootRef: RefObject<HTMLElement | null>;
  /** The band the ribbon may move in. */
  bounds: RibbonBounds;
  /** Where the person put the ribbon; null means the default place. */
  requestedTop: number | null;
  /** True while the person is dragging it. */
  dragging: boolean;
};

export function useInstallRibbonDock({
  rootRef,
  bounds,
  requestedTop,
  dragging,
}: UseInstallRibbonDockOptions): { dock: InstallRibbonDock; top: number } {
  const [dock, setDock] = useState<InstallRibbonDock>("unknown");
  const [top, setTop] = useState(0);
  const [revision, setRevision] = useState(0);
  /** The last measured controls and text. */
  const blockersRef = useRef<RibbonRect[]>([]);
  /** Where the ribbon is placed. Null until the band is known. */
  const placedTopRef = useRef<number | null>(null);
  /** The band the last placement was made in. */
  const previousBoundsRef = useRef<RibbonBounds | null>(null);

  // The page moves under the ribbon. Re-check when it does.
  useEffect(() => {
    let timer: number | undefined;
    const recheck = () => {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        setRevision((value) => value + 1);
      }, RIBBON_RECHECK_MS);
    };
    // Capture: an inner region scrolling moves the content too.
    window.addEventListener("scroll", recheck, true);
    const observer = new MutationObserver(recheck);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      window.removeEventListener("scroll", recheck, true);
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const bandChanged =
      previousBoundsRef.current === null ||
      previousBoundsRef.current.minTop !== bounds.minTop ||
      previousBoundsRef.current.maxTop !== bounds.maxTop;
    previousBoundsRef.current = bounds;

    // The band is not known yet: the first render happens before the
    // ribbon has measured itself, and an empty band has nowhere to put
    // a 44px tab. Wait for the real band instead of placing the tab at
    // the top of the screen, over the sticky header.
    if (bounds.maxTop <= bounds.minTop) return;

    // While the person drags, the controls are measured once and then
    // reused: a drag must not re-measure the page on every pointer move.
    const blockers = dragging ? blockersRef.current : contentRects(rootRef.current);
    if (!dragging) blockersRef.current = blockers;

    const tabLeft = Math.max(0, viewportWidth() - RIBBON_TILE_SIZE);
    const preferred = ribbonStops(bounds)[1];
    const inGutter = ribbonFitsGutter(contentGutter());
    const clearAt = (candidate: number) =>
      ribbonClearTop([candidate], tabLeft, RIBBON_TILE_SIZE, blockers);

    // While the person drags the ribbon it follows the pointer, but it
    // never lands on a control: it stops at the nearest clear place.
    if (dragging) {
      const asked = requestedTop ?? placedTopRef.current ?? preferred;
      const spot =
        overlapsAny(ribbonTabRect(asked, tabLeft, RIBBON_TILE_SIZE), blockers)
          ? ribbonClearTop(
              ribbonCandidates(bounds, asked),
              tabLeft,
              RIBBON_TILE_SIZE,
              blockers,
            )
          : asked;
      if (spot === null) {
        setDock("none");
        return;
      }
      placedTopRef.current = spot;
      setDock(inGutter ? "gutter" : "clear");
      setTop(spot);
      return;
    }

    // A PLACEMENT: the first one. The place is FOUND by looking for a
    // clear spot in the band — it is never assumed to be the preferred
    // middle, which on a dense page is exactly where the rows are.
    if (placedTopRef.current === null) {
      const spot = ribbonClearTop(
        ribbonCandidates(bounds, preferred),
        tabLeft,
        RIBBON_TILE_SIZE,
        blockers,
      );
      if (spot === null) {
        setDock("none");
        return;
      }
      placedTopRef.current = spot;
      setDock(inGutter ? "gutter" : "clear");
      setTop(spot);
      return;
    }

    // The place the ribbon IS at. In order: where the person put it — but
    // only while that place is FREE — the place this hook FOUND when it
    // placed the ribbon, and only then the preferred middle.
    //
    // The found place must survive a re-check. The ribbon's own DOM
    // change makes the page check again, and falling back to the middle
    // would put it back over the rows and hide it for good.
    //
    // A BAND change is different: the band itself moved (a resize, a
    // rotation, the ribbon opening), so the ribbon follows the band and
    // takes the middle of the new band.
    //
    // And a drag that ended ON a control is the same case: while the
    // drag ran, the raw pointer position was corrected to the nearest
    // clear place, and the release must keep that corrected place. Using
    // the raw position here would put the ribbon back on the control and
    // hide it — the ribbon would vanish under the finger.
    const asked = requestedTop !== null ? clampRibbonTop(requestedTop, bounds) : null;
    const actual =
      asked !== null && clearAt(asked) === asked
        ? asked
        : bandChanged
          ? preferred
          : clampRibbonTop(placedTopRef.current ?? preferred, bounds);
    if (clearAt(actual) === actual) {
      placedTopRef.current = actual;
      setDock(inGutter ? "gutter" : "clear");
      setTop(actual);
      return;
    }

    // The band moved under the ribbon (a resize, a rotation, or the
    // ribbon opening): look for a clear place in the new band, starting
    // from where the ribbon was.
    if (bandChanged) {
      const spot = ribbonClearTop(
        ribbonCandidates(bounds, actual),
        tabLeft,
        RIBBON_TILE_SIZE,
        blockers,
      );
      if (spot === null) {
        setDock("none");
        return;
      }
      placedTopRef.current = spot;
      setDock(inGutter ? "gutter" : "clear");
      setTop(spot);
      return;
    }

    // The page moved over the ribbon: it steps aside rather than
    // jumping around, and it returns when the place is clear again.
    setDock("none");
  }, [bounds, requestedTop, dragging, revision, rootRef]);

  return { dock, top };
}
