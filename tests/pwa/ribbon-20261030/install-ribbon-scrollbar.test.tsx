// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useMemo, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RIBBON_HEADER_CLEARANCE,
  RIBBON_TILE_SIZE,
  overlapsAny,
  ribbonBounds,
} from "@/components/pwa/install-ribbon-geometry";
import { contentGutter, viewportWidth } from "@/components/pwa/install-ribbon-measure";
import { useInstallRibbonDock } from "@/components/pwa/use-install-ribbon-dock";

// The install ribbon against a CLASSIC (space taking) scrollbar.
//
// The staging regression of 30 October 2026, measured in real Chrome at
// 390×844:
//
//   window.innerWidth                 = 390   (the window, scrollbar included)
//   document.documentElement.clientWidth = 375 (the width the page is laid out in)
//   the Install Aqua button (fixed right-0):
//     left 331.2, right 375.2, width 44
//
// The ribbon is `fixed right-0`, so Chrome paints it against the LAYOUT
// viewport: its right edge is the layout width (375), not the window
// width (390). The collision check used `window.innerWidth - 44` = 346,
// which is 15px to the RIGHT of the square Chrome actually painted, so
// the ribbon's leftmost 15px covered what the check had called clear —
// a right-aligned payment amount (₹7,540 in Payment mix).
//
// These tests hold the ribbon to the invariant that fixes it: EVERY
// number that says where the ribbon may sit has to be in the same
// coordinates as the square the browser paints.
//
// Agent-owned file (tests/pwa/ribbon-20261030/**).

/** The staging window: 390px wide, with a classic 15px scrollbar. */
const WINDOW_WIDTH = 390;
const SCROLLBAR_WIDTH = 15;
/** The width the page is actually laid out in — where `fixed right-0` lands. */
const LAYOUT_WIDTH = WINDOW_WIDTH - SCROLLBAR_WIDTH;
/** The tab is the shared control contract's 44px target. */
const TAB_SIZE = RIBBON_TILE_SIZE;
const VIEWPORT_HEIGHT = 844;

/** A rectangle, in the coordinates the browser measures in. */
function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The window's own width (what `window.innerWidth` reports). */
function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

/** The width the page is laid out in (what `clientWidth` reports). */
function setLayoutWidth(width: number): void {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
}

/**
 * Chrome's Range geometry for a TEXT node.
 *
 * jsdom has no `Range.getClientRects` at all, so the ribbon's text
 * measurement falls back to "no text rectangles" — which is exactly why
 * the unit suite could not see a right-aligned amount being covered. A
 * range over a text node returns the text's own line boxes in Chrome;
 * for an inline parent that box is the parent's own box.
 */
function installChromeTextRects(): void {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    writable: true,
    value(this: Range): DOMRect[] {
      const container = this.startContainer;
      const parent =
        container.nodeType === Node.TEXT_NODE
          ? container.parentElement
          : container instanceof Element
            ? container
            : null;
      if (!parent) return [];
      const box = parent.getBoundingClientRect();
      return box.width > 0 && box.height > 0 ? [box] : [];
    },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document.documentElement, "clientWidth");
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  setWindowWidth(1024);
});

describe("the width the page is drawn in", () => {
  it("measures the width the page is laid out in, not the window's width", () => {
    // A classic scrollbar takes 15px of the window: the page is laid
    // out in 375px, and `fixed right-0` is painted against those 375px.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);

    expect(viewportWidth()).toBe(LAYOUT_WIDTH);
  });

  it("keeps the whole width when the scrollbar is an overlay", () => {
    // An overlay scrollbar takes no room, so the window's width IS the
    // width the page is drawn in.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(WINDOW_WIDTH);

    expect(viewportWidth()).toBe(WINDOW_WIDTH);
  });

  it("falls back to the window's width when the browser has no layout", () => {
    // jsdom, a hidden frame: the document reports no drawable width.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(0);

    expect(viewportWidth()).toBe(WINDOW_WIDTH);
  });

  it("ignores an unusable layout width", () => {
    setWindowWidth(WINDOW_WIDTH);

    setLayoutWidth(Number.NaN);
    expect(viewportWidth()).toBe(WINDOW_WIDTH);

    setLayoutWidth(-1);
    expect(viewportWidth()).toBe(WINDOW_WIDTH);
  });

  it("has no width on the server", () => {
    vi.stubGlobal("window", undefined);

    expect(viewportWidth()).toBe(0);
  });
});

describe("the page's right gutter", () => {
  /** A page whose content ends at `right`. */
  function renderPage(right: number): void {
    const { container } = render(<main />);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    vi.spyOn(main as HTMLElement, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, right, VIEWPORT_HEIGHT),
    );
  }

  it("does not count the scrollbar as page room", () => {
    // The content fills the width the page is drawn in, so there is no
    // gutter at all. `innerWidth` would have counted the scrollbar's
    // 15px as page room and invented a gutter that does not exist.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);
    renderPage(LAYOUT_WIDTH);

    expect(contentGutter()).toBe(0);
  });

  it("measures the gutter in the width the ribbon is placed in", () => {
    // The content ends 55px before the layout width: that is the real
    // gutter, and it is what the ribbon has to fit into.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);
    renderPage(LAYOUT_WIDTH - 55);

    expect(contentGutter()).toBe(55);
  });

  it("counts the whole window when the scrollbar is an overlay", () => {
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(WINDOW_WIDTH);
    renderPage(WINDOW_WIDTH - 55);

    expect(contentGutter()).toBe(55);
  });

  it("has no gutter without a page", () => {
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);

    expect(contentGutter()).toBe(0);
  });

  it("has no gutter when the page has no measurable right edge", () => {
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);
    renderPage(0);

    expect(contentGutter()).toBe(0);
  });
});

/**
 * The ribbon, as the real component draws it.
 *
 * `components/pwa/install-ribbon.tsx` renders the tab as `fixed right-0`
 * with a 44px square, so the browser paints it against the LAYOUT
 * viewport's right edge. The harness mirrors that markup so the dock's
 * collision rectangle can be compared with the square that is painted.
 */
function RibbonHarness() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bounds = useMemo(
    () =>
      ribbonBounds({
        viewportHeight: VIEWPORT_HEIGHT,
        ribbonHeight: TAB_SIZE,
        headerClearance: RIBBON_HEADER_CLEARANCE,
        safeAreaBottom: 0,
      }),
    [],
  );
  const dock = useInstallRibbonDock({
    rootRef,
    bounds,
    requestedTop: null,
    dragging: false,
  });

  if (dock.dock === "unknown" || dock.dock === "none") return null;

  return (
    <div
      ref={rootRef}
      data-ribbon="install"
      data-ribbon-dock={dock.dock}
      className="fixed right-0 z-40"
      style={{ top: `${dock.top}px` }}
    >
      <button type="button" className="h-11 w-11" aria-label="Install Aqua" />
    </div>
  );
}

/** Where Chrome paints the tab, for a tab placed at `top`. */
function paintedTabRect(top: number) {
  return rect(LAYOUT_WIDTH - TAB_SIZE, top, LAYOUT_WIDTH, top + TAB_SIZE);
}

/** Lets the dock place the ribbon and then re-check it, as a page does. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
}

describe("the ribbon's collision", () => {
  /** The page Chrome measured: a page with one amount in it. */
  function renderStagingPage(
    amount: { left: number; top: number; right: number; bottom: number },
    mainRight = LAYOUT_WIDTH,
  ) {
    installChromeTextRects();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.getAttribute("data-testid") === "amount") {
        return rect(amount.left, amount.top, amount.right, amount.bottom);
      }
      if (this.tagName === "MAIN") {
        return rect(0, 0, mainRight, VIEWPORT_HEIGHT);
      }
      // Every other element has no box: the page holds nothing else.
      return rect(0, 0, 0, 0);
    });
    return render(
      <>
        <main>
          <span data-testid="amount">₹7,540</span>
        </main>
        <RibbonHarness />
      </>,
    );
  }

  it("never paints the tab over a right-aligned amount", async () => {
    // The staging page: the amount is right-aligned and ends at 339px,
    // inside the 15px strip (331..346) that the window's width put
    // outside the tab's collision rectangle.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);
    const amount = { left: 291, top: 396, right: 339, bottom: 420 };
    const { container } = renderStagingPage(amount);
    await settle();

    const ribbon = container.querySelector<HTMLElement>('[data-ribbon="install"]');
    expect(ribbon).not.toBeNull();
    const top = Number.parseFloat((ribbon as HTMLElement).style.top);
    // Chrome paints `fixed right-0` against the layout width (375), so
    // the tab's square is [331, 375] — not [346, 390].
    const painted = paintedTabRect(top);
    expect(painted.left).toBe(331);
    expect(painted.right).toBe(375);
    // The square the browser paints must not cover the amount.
    expect(overlapsAny(painted, [rect(amount.left, amount.top, amount.right, amount.bottom)])).toBe(
      false,
    );
  });

  it("does not claim a gutter that the scrollbar is part of", async () => {
    // The page's content ends at 335px, so the real gutter is 40px and
    // cannot hold the 44px tab. `innerWidth` would have counted the
    // scrollbar's 15px as page room, called it 55px, and parked the tab
    // over the content while claiming the tab covered nothing.
    setWindowWidth(WINDOW_WIDTH);
    setLayoutWidth(LAYOUT_WIDTH);
    const { container } = renderStagingPage(
      {
        left: 291,
        top: 600,
        right: 339,
        bottom: 624,
      },
      // The page's content ends at 335px, so the real gutter is 40px
      // and cannot hold the 44px tab.
      LAYOUT_WIDTH - 40,
    );
    await settle();

    const ribbon = container.querySelector<HTMLElement>('[data-ribbon="install"]');
    expect(ribbon).not.toBeNull();
    expect(ribbon?.getAttribute("data-ribbon-dock")).toBe("clear");
  });
});
