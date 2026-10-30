// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallAffordance } from "@/components/pwa/install-affordance";
import {
  INSTALL_DISMISSAL_KEY,
  INSTALL_OFFER_DELAY_MS,
  INSTALL_OFFER_VISIBLE_MS,
  INSTALL_OFFER_SHOWN_KEY,
} from "@/lib/offline/install-prompt";
import { installChromeRangeGeometry } from "./chrome-range-geometry";

// 30 October human revision: Chromium taps install directly. Existing
// expandable presentation checks below now cover iOS guidance only.
// The install side ribbon — docs/design/pwa-side-ribbon-20261030/.
//
// The human asked for the install offer to arrive "like a ribbon coming
// from the side, and collapsable, and draggable if possible? like quick
// shortcut things". These tests hold that presentation to the PWA
// contract in docs/design-system/pwa.md and to the independent Chrome
// review of 30 October 2026 (R1):
//
//   * the ribbon appears COLLAPSED after the existing delay and opens
//     only when the person asks — an initial panel would cover the
//     page's filters;
//   * the collapsed ribbon is ONE slim edge tab; the move handle only
//     exists while the ribbon is open;
//   * the tab is docked to the RIGHT edge (root's placement correction:
//     a left-edge ribbon would cover the desktop sidebar navigation);
//   * the timed offer folds back into the tab instead of vanishing, and
//     it never opens by itself twice in one session;
//   * Escape collapses the ribbon and gives the focus back to the tab;
//   * it never folds away while the keyboard focus is inside it;
//   * the move handle is its own control: it drags the ribbon, it never
//     installs, and it is neither the install nor the collapse control;
//   * a CANCELLED drag never swallows the next deliberate click;
//   * the ribbon stays inside the viewport, clear of the navigation;
//   * it steps aside for a modal that is really open — a dialog that is
//     hidden, or inside a hidden ancestor, is not an open dialog — and
//     it comes back when that ancestor is revealed again;
//   * it steps aside while a text field outside the ribbon has focus;
//   * the native install prompt is only ever called by an explicit
//     Install click.
//
// The route, platform, offline, installed and dismissal protections are
// re-stated here so the ribbon cannot quietly become an install prompt
// on a surface that must never carry one.
//
// Agent-owned file (tests/pwa/ribbon-20261030/**).

class FakeInstallPromptEvent extends Event {
  prompt = vi.fn(async () => {});
  userChoice = Promise.resolve({ outcome: "accepted" as const });
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** The measured band the ribbon may move in (see install-ribbon-geometry.ts). */
const VIEWPORT_HEIGHT = 844;
/** The expanded ribbon (the panel) is taller; the collapsed one is the 44px tab. */
const RIBBON_HEIGHT = 96;
const MIN_TOP = 56;
/** The band of the EXPANDED ribbon — the move handle only exists while it is open. */
const MAX_TOP = VIEWPORT_HEIGHT - 64 - RIBBON_HEIGHT;
const MIDDLE_TOP = (MIN_TOP + MAX_TOP) / 2;
/** The middle of the COLLAPSED ribbon's band (the 44px tab). */
const COLLAPSED_MIDDLE_TOP = (MIN_TOP + (VIEWPORT_HEIGHT - 64 - 44)) / 2;

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
}

function fireInstallEvent(native = false) {
  const event = new FakeInstallPromptEvent("beforeinstallprompt");
  // This suite exercises the retained iOS guidance and shared docking.
  // Native direct-install cases opt in to the actual Chromium event.
  if (native) fireEvent(window, event);
  return event;
}

function ribbonRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-ribbon="install"]');
  if (!root) throw new Error("the install ribbon is not rendered");
  return root;
}

function ribbonTop(container: HTMLElement): number {
  return Number.parseFloat(ribbonRoot(container).style.top);
}

function ribbonPhase(container: HTMLElement): string | null {
  return (
    container
      .querySelector<HTMLElement>('section[aria-label="Install Aqua"]')
      ?.getAttribute("data-ribbon-phase") ?? null
  );
}

function tab(): HTMLElement {
  return screen.getByRole("button", { name: /install options/i });
}

function handle(): HTMLElement {
  return screen.getByRole("button", { name: /move install ribbon/i });
}

/** Renders the affordance and waits for the timed offer to arrive. */
async function showRibbon(pathname = "/owner") {
  const view = render(<InstallAffordance pathname={pathname} />);
  fireInstallEvent();
  await act(async () => {
    vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
  });
  return view;
}

/** Opens the ribbon the way a person does: one tap on the tab. */
async function openRibbon() {
  await act(async () => {
    fireEvent.click(tab());
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: VIEWPORT_HEIGHT });
  setUserAgent(IPHONE_UA);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  // The ribbon measures the page before it may dock, so the mock has to
  // answer with a plausible page: a 20px right gutter (the phone's
  // `main.px-5`), a fixed 96px ribbon, and a row action that sits below
  // the ribbon's place until the page scrolls.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const width = window.innerWidth - 20;
    const scrolled = window.scrollY;
    if (this.tagName === "A") {
      // A row action in the lower half of the page: it moves up with the
      // scroll, so it can end up under the ribbon.
      return {
        width,
        height: window.innerHeight - 600,
        top: 600 - scrolled,
        left: 0,
        right: width,
        bottom: window.innerHeight - scrolled,
        x: 0,
        y: 600 - scrolled,
        toJSON: () => ({}),
      } as DOMRect;
    }
    return {
      width: 48,
      height: RIBBON_HEIGHT,
      top: 0,
      left: 0,
      right: width,
      bottom: RIBBON_HEIGHT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // navigator.onLine and scrollY are defined with defineProperty, which
  // the mock restore does not undo: the next test must not inherit an
  // offline device or a scrolled page.
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

describe("iOS guidance and shared ribbon placement (Chromium direct mode has its own regressions)", () => {
  it("arrives collapsed and opens only when the person asks", async () => {
    const { container } = await showRibbon();

    // The panel must not ambush the page: it may cover the filters.
    expect(tab().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(ribbonPhase(container)).toBe("closed");

    await openRibbon();
    expect(tab().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /not now/i })).toBeTruthy();
  });

  it("is one slim tab while collapsed, and the move handle only exists while open", async () => {
    const { container } = await showRibbon();
    const ribbon = ribbonRoot(container);

    // One tile, not a column of floating tiles. The count is the
    // ACCESSIBLE one: the collapsed panel stays in the DOM (so
    // aria-controls resolves) but it is hidden, so it is not a control
    // the person can see or reach.
    expect(ribbon.querySelectorAll("button")).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /move install ribbon/i })).toBeNull();

    await openRibbon();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /move install ribbon/i })).toBeTruthy();
  });

  it("keeps a full 44px target for the collapsed tab", async () => {
    await showRibbon();

    // The shared control contract is 44px, and WCAG's 24px minimum does
    // not replace it. The tab is one 44px target, whatever the page's
    // gutter is.
    const tabElement = tab();
    expect(tabElement.className).toContain("w-11");
    expect(tabElement.className).not.toContain("w-6");
  });

  it("does not dock on top of a row action", async () => {
    // A row action that runs the whole page: there is no clear place.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "A") {
        return {
          width,
          height: window.innerHeight,
          top: 0,
          left: 0,
          right: width,
          bottom: window.innerHeight,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { container } = render(
      <>
        <main>
          <a href="#member-row">A member row that runs the page height</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // There is no clear 44px place on this page, so the ribbon does not
    // render at all: it never covers a row and never steals a click.
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("re-checks its place when the page scrolls under it", async () => {
    const { container } = render(
      <>
        <main>
          <a href="#row">A row action in the lower part of the page</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    // The page scrolls: a row action moves up under the tab, and the
    // ribbon must notice and step aside.
    Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
    await act(async () => {
      fireEvent.scroll(window);
      vi.advanceTimersByTime(300);
    });

    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("re-checks its place when a row action arrives late", async () => {
    // The late action lands exactly where the ribbon is.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "A") {
        return {
          width,
          height: window.innerHeight,
          top: 0,
          left: 0,
          right: width,
          bottom: window.innerHeight,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    function Harness() {
      const [late, setLate] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setLate(true)}>
            Load the rows
          </button>
          {late ? <a href="#row">A row action that arrives late</a> : null}
          <InstallAffordance pathname="/owner" />
        </>
      );
    }

    const { container } = render(<Harness />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /load the rows/i }));
      vi.advanceTimersByTime(300);
    });

    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("re-checks the place a drag ended on", async () => {
    const { container } = render(
      <>
        <main>
          <a href="#row">A row action under the lower part of the page</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    await openRibbon();
    const move = handle();

    // The drag ends on the row action that sits under the tab's place.
    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 630 });
      fireEvent.pointerUp(move, { pointerId: 1, clientY: 630 });
      vi.advanceTimersByTime(300);
    });

    // The ribbon may not stay on a control: it re-docks or steps aside.
    const root = container.querySelector('[data-ribbon="install"]');
    if (root) {
      const top = Number.parseFloat((root as HTMLElement).style.top);
      const covered = Array.from(document.querySelectorAll("a[href]")).some((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.right > window.innerWidth - 44 &&
          rect.left < window.innerWidth &&
          rect.bottom > top &&
          rect.top < top + 44
        );
      });
      expect(covered).toBe(false);
    }
  });

  it("places the ribbon at a clear spot, not at the preferred middle", async () => {
    // A page like the phone's Members list: a sticky header at the top
    // and a row action across the middle of the band. The band is not
    // known on the first render, so the ribbon must wait for it — and
    // then it must find a CLEAR place, not assume the preferred middle
    // (which is exactly where the rows are).
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "A") {
        return {
          width,
          height: 200,
          top: 300,
          left: 0,
          right: width,
          bottom: 500,
          x: 0,
          y: 300,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { container } = render(
      <>
        <header>
          <button type="button">Theme</button>
        </header>
        <main>
          <a href="#row">A row action across the middle of the page</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    const root = container.querySelector('[data-ribbon="install"]');
    expect(root).not.toBeNull();
    const top = Number.parseFloat((root as HTMLElement).style.top);
    // Not the degenerate first measurement (the very top of the screen,
    // over the sticky header)…
    expect(top).toBeGreaterThan(96);
    // …and not on the row action either.
    const row = document.querySelector("a[href]")!.getBoundingClientRect();
    expect(top + 44 > row.top && top < row.bottom).toBe(false);
  });

  it("does not treat a full-width wrapper as text", async () => {
    // Chrome's Range geometry: a range over the page's contents returns
    // the descendant ELEMENTS' boxes as well as the text rectangles, so
    // a full-width card or section becomes a blocker that spans the
    // page. jsdom has no Range geometry at all, which is why the unit
    // suite never saw this.
    installChromeRangeGeometry();

    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "SECTION" || this.tagName === "MAIN") {
        // The full-width wrapper the content sits in.
        return {
          width,
          height: window.innerHeight,
          top: 0,
          left: 0,
          right: width,
          bottom: window.innerHeight,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
      if (this.tagName === "A") {
        // One row action, in the middle of the page.
        return {
          width,
          height: 200,
          top: 300,
          left: 0,
          right: width,
          bottom: 500,
          x: 0,
          y: 300,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { container } = render(
      <>
        <main>
          <section>
            <a href="#row">A row action</a>
          </section>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // The wrapper's box spans the page, but it is a WRAPPER, not text:
    // the ribbon must still find a place that is clear of the row.
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
  });

  it("keeps the place it found when the page checks again", async () => {
    // A row action across the middle of the band: the preferred middle is
    // blocked, so the ribbon has to find a clear place somewhere else.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "A") {
        return {
          width,
          height: 200,
          top: 300,
          left: 0,
          right: width,
          bottom: 500,
          x: 0,
          y: 300,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { container } = render(
      <>
        <main>
          <a href="#row">A row action across the middle of the page</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    const root = container.querySelector('[data-ribbon="install"]');
    expect(root).not.toBeNull();
    const found = Number.parseFloat((root as HTMLElement).style.top);
    // A place that was FOUND, not the preferred middle: the row action
    // covers the middle, so the ribbon had to find somewhere else.
    expect(found).not.toBe(COLLAPSED_MIDDLE_TOP);
    // ...and it is not on the row action either.
    expect(found + 44 > 300 && found < 500).toBe(false);

    // The ribbon's own DOM change makes the page re-check its place.
    // The place it found must survive that: it must not fall back to
    // the blocked middle and disappear.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    const again = container.querySelector('[data-ribbon="install"]');
    expect(again).not.toBeNull();
    expect(Number.parseFloat((again as HTMLElement).style.top)).toBe(found);

    // And it does not oscillate: the ribbon's own DOM change must not
    // send it back and forth.
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    const settled = container.querySelector('[data-ribbon="install"]');
    expect(settled).not.toBeNull();
    expect(Number.parseFloat((settled as HTMLElement).style.top)).toBe(found);
  });

  it("keeps the corrected place when a drag is released over a control", async () => {
    // A row action across the middle of the band: a drop there has to be
    // corrected to the nearest clear place, and the ribbon must STAY
    // there when the finger lifts. The raw pointer position is blocked,
    // so using it after the release would put the ribbon back on the
    // control and hide it.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const width = window.innerWidth - 20;
      if (this.tagName === "A") {
        return {
          width,
          height: 200,
          top: 300,
          left: 0,
          right: width,
          bottom: 500,
          x: 0,
          y: 300,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return {
        width: 48,
        height: RIBBON_HEIGHT,
        top: 0,
        left: 0,
        right: width,
        bottom: RIBBON_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });

    const { container } = render(
      <>
        <main>
          <a href="#row">A row action across the middle of the page</a>
        </main>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    await openRibbon();

    // Drag so the raw position lands ON the row action (300..500).
    const start = ribbonTop(container);
    const drop = 400;
    const move = handle();
    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 400 + (drop - start) });
      fireEvent.pointerUp(move, { pointerId: 1, clientY: 400 + (drop - start) });
      vi.advanceTimersByTime(400);
    });

    // The drop was corrected to a clear place, and the ribbon is still
    // there, at that same clear place.
    const root = container.querySelector('[data-ribbon="install"]');
    expect(root).not.toBeNull();
    const top = Number.parseFloat((root as HTMLElement).style.top);
    expect(top).not.toBe(drop);
    expect(top + 44 > 300 && top < 500).toBe(false);
  });

  it("docks to the right edge and opens inward, to the left", async () => {
    const { container } = await showRibbon();
    const root = ribbonRoot(container);

    // Root's correction (30 October 2026): the RIGHT edge, because a
    // left-edge ribbon would cover the desktop sidebar navigation and
    // obstructing navigation is the stronger requirement.
    expect(root.getAttribute("data-ribbon-edge")).toBe("right");
    expect(root.className).toContain("right-0");
    expect(root.className).not.toContain("left-0");

    // The panel is the first child, so it grows leftwards, inward from
    // the edge, and the tab stays on the edge.
    const panel = container.querySelector('section[aria-label="Install Aqua"]');
    const tabElement = tab();
    expect(panel).not.toBeNull();
    expect(
      panel!.compareDocumentPosition(tabElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("folds the timed offer back into a side tab instead of removing it", async () => {
    await showRibbon();
    await openRibbon();
    expect(tab().getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_VISIBLE_MS + 10);
    });

    // The ribbon is still there as a tab, and the offer is folded away.
    expect(tab()).toBeTruthy();
    expect(tab().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("collapses on Escape and gives the focus back to the tab", async () => {
    await showRibbon();
    await openRibbon();
    const install = screen.getByRole("button", { name: /not now/i });
    install.focus();

    await act(async () => {
      fireEvent.keyDown(install, { key: "Escape" });
    });

    expect(tab().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(tab());
  });

  it("stays open while the keyboard focus is inside the ribbon", async () => {
    await showRibbon();
    await openRibbon();
    screen.getByRole("button", { name: /not now/i }).focus();

    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_VISIBLE_MS + 10);
    });

    expect(tab().getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps the move handle separate from the install and the collapse control", async () => {
    await showRibbon();
    await openRibbon();

    const move = handle();
    expect(move).not.toBe(tab());
    expect(move).not.toBe(screen.getByRole("button", { name: /not now/i }));

    // The handle neither installs nor collapses the ribbon.
    await act(async () => {
      fireEvent.click(move);
    });
    expect(tab().getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByText(/installed/i)).toBeNull();
  });

  it("drags the ribbon with the move handle", async () => {
    const { container } = await showRibbon();
    await openRibbon();
    expect(ribbonTop(container)).toBe(MIDDLE_TOP);

    const move = handle();
    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 300 });
      fireEvent.pointerUp(move, { pointerId: 1, clientY: 300 });
    });

    expect(ribbonTop(container)).toBe(MIDDLE_TOP - 100);
  });

  it("never installs from a drag", async () => {
    const { container } = await showRibbon();
    const event = fireInstallEvent(true);
    const direct = screen.getByRole("button", { name: /^install aqua$/i });
    const top = ribbonTop(container);
    await act(async () => {
      fireEvent.pointerDown(direct, { pointerId: 1, button: 0, clientY: 400 });
      fireEvent.pointerMove(direct, { pointerId: 1, clientY: 300 });
      fireEvent.pointerUp(direct, { pointerId: 1, clientY: 300 });
      fireEvent.click(direct);
    });
    expect(event.prompt).not.toHaveBeenCalled();
    expect(screen.queryByText(/installed/i)).toBeNull();
    expect(ribbonTop(container)).toBeLessThan(top);

  });

  it("cycles bounded stops when the move handle is clicked", async () => {
    const { container } = await showRibbon();
    await openRibbon();
    const move = handle();

    await act(async () => {
      fireEvent.click(move);
    });
    expect(ribbonTop(container)).toBe(MAX_TOP);

    await act(async () => {
      fireEvent.click(move);
    });
    expect(ribbonTop(container)).toBe(MIN_TOP);

    await act(async () => {
      fireEvent.click(move);
    });
    expect(ribbonTop(container)).toBe(MIDDLE_TOP);
  });

  it("moves the ribbon with the arrow keys", async () => {
    const { container } = await showRibbon();
    await openRibbon();
    const move = handle();
    move.focus();

    await act(async () => {
      fireEvent.keyDown(move, { key: "ArrowUp" });
    });
    expect(ribbonTop(container)).toBe(MIDDLE_TOP - 24);

    await act(async () => {
      fireEvent.keyDown(move, { key: "ArrowDown" });
    });
    expect(ribbonTop(container)).toBe(MIDDLE_TOP);
  });

  it("clamps the ribbon inside the viewport", async () => {
    const { container } = await showRibbon();
    await openRibbon();
    const move = handle();

    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 5000 });
      fireEvent.pointerUp(move, { pointerId: 1, clientY: 5000 });
    });

    expect(ribbonTop(container)).toBe(MAX_TOP);
  });

  it("clamps the ribbon again when the viewport changes", async () => {
    const { container } = await showRibbon();
    await openRibbon();
    const move = handle();

    // Move it first: a ribbon the person placed keeps its place and is
    // only clamped, never re-centred under them.
    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 5000 });
      fireEvent.pointerUp(move, { pointerId: 1, clientY: 5000 });
    });
    expect(ribbonTop(container)).toBe(MAX_TOP);

    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(ribbonTop(container)).toBe(400 - 64 - RIBBON_HEIGHT);
  });

  it("gets out of the way while a modal dialog is open", async () => {
    function Harness() {
      const [modal, setModal] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setModal(false)}>
            Close the modal
          </button>
          {modal ? <dialog open data-testid="modal" /> : null}
          <InstallAffordance pathname="/owner" />
        </>
      );
    }

    const { container } = render(<Harness />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /close the modal/i }));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
  });

  it("is not put away by a dialog that is not really open", async () => {
    const { container } = render(
      <>
        <div role="dialog" hidden />
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // A hidden dialog is not an open dialog.
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
  });

  it("is not put away by a dialog inside a hidden ancestor", async () => {
    const { container } = render(
      <>
        <div hidden>
          <div role="dialog" />
        </div>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // The dialog's own box is visible, but its ANCESTOR is not: the
    // dialog is not on the screen.
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
  });

  it("follows a hidden ancestor when it is revealed", async () => {
    function Harness() {
      const [hidden, setHidden] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setHidden(false)}>
            Show the dialog
          </button>
          {/* The class is how the app hides things; the inline style is
              what a browserless test can actually measure. */}
          <div className={hidden ? "hidden" : "block"} style={{ display: hidden ? "none" : "block" }}>
            <div role="dialog" />
          </div>
          <InstallAffordance pathname="/owner" />
        </>
      );
    }

    const { container } = render(<Harness />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /show the dialog/i }));
      await Promise.resolve();
    });
    // The dialog is on the screen now: the ribbon steps aside.
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("steps aside for a styled select's combobox trigger", async () => {
    // The shared Select is owned by another lane and is built from a
    // button with role="combobox", not from a native <select>: the
    // ribbon must know that is a field too.
    const { container } = render(
      <>
        <button
          type="button"
          role="combobox"
          aria-expanded="false"
          aria-controls="status-options"
          aria-label="Status"
        >
          All statuses
        </button>
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    await act(async () => {
      screen.getByRole("combobox", { name: /status/i }).focus();
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("steps aside while a styled select's options are open", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            type="button"
            role="combobox"
            aria-expanded={open ? "true" : "false"}
            aria-controls="status-options"
            aria-label="Status"
            onClick={() => setOpen(true)}
          >
            All statuses
          </button>
          {open ? (
            <ul id="status-options" role="listbox" aria-label="Status options">
              <li role="option" aria-selected="false">
                Active
              </li>
            </ul>
          ) : null}
          <InstallAffordance pathname="/owner" />
        </>
      );
    }

    const { container } = render(<Harness />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    // The options open: they are on the screen, and the ribbon must not
    // cover them. The trigger is not focused here, so this is the
    // aria-expanded rule on its own.
    await act(async () => {
      fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
      await Promise.resolve();
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("stays out of the way while a text field outside the ribbon has focus", async () => {
    const { container } = render(
      <>
        <input aria-label="Member name" />
        <InstallAffordance pathname="/owner" />
      </>,
    );
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();

    await act(async () => {
      screen.getByLabelText("Member name").focus();
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("does not reopen when the device comes back online", async () => {
    const { container } = await showRibbon();
    expect(tab().getAttribute("aria-expanded")).toBe("false");

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    await act(async () => {
      fireEvent(window, new Event("offline"));
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    await act(async () => {
      fireEvent(window, new Event("online"));
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // The ribbon comes back as a tab. It must never replay the opening.
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
    expect(tab().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("never swallows the next deliberate click after a cancelled drag", async () => {
    await showRibbon();
    await openRibbon();
    const move = handle();

    await act(async () => {
      fireEvent.pointerDown(move, { pointerId: 1, clientY: 400 });
      fireEvent.pointerMove(move, { pointerId: 1, clientY: 300 });
      // The browser took the gesture away. A cancel never produces a
      // following click, so nothing may be left waiting to swallow one.
      fireEvent.pointerCancel(move, { pointerId: 1, clientY: 300 });
    });

    // The next deliberate action must work, exactly once.
    await act(async () => {
      fireEvent.click(tab());
    });
    expect(tab().getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      fireEvent.click(tab());
    });
    expect(tab().getAttribute("aria-expanded")).toBe("true");
  });

  it("installs when the click follows a cancelled drag", async () => {
    await showRibbon();
    const event = fireInstallEvent(true);
    const direct = screen.getByRole("button", { name: /^install aqua$/i });
    await act(async () => {
      fireEvent.pointerDown(direct, { pointerId: 1, button: 0, clientY: 400 });
      fireEvent.pointerMove(direct, { pointerId: 1, clientY: 300 });
      fireEvent.pointerCancel(direct, { pointerId: 1, clientY: 300 });
      fireEvent.click(direct);
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("slides in on a user expansion", async () => {
    const { container } = await showRibbon();
    expect(ribbonPhase(container)).toBe("closed");

    await act(async () => {
      fireEvent.click(tab());
    });
    expect(ribbonPhase(container)).toBe("opening");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(ribbonPhase(container)).toBe("open");
  });

  it("never calls the native install prompt on its own", async () => {
    await showRibbon();
    const event = fireInstallEvent(true);
    await act(async () => { vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10); });
    expect(event.prompt).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^install aqua$/i })); });
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("never appears on the sign-in, operator or parent surfaces", async () => {
    for (const pathname of ["/login", "/set-pin", "/ops", "/parent", "/p/9f2c-secret-token"]) {
      const { container } = render(<InstallAffordance pathname={pathname} />);
      fireInstallEvent();
      await act(async () => {
        vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
      });
      expect(container.querySelector('[data-ribbon="install"]'), pathname).toBeNull();
      cleanup();
    }
  });

  it("stays away while the device is offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("stays away when the app is already installed", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("standalone"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    const { container } = render(<InstallAffordance pathname="/owner" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("remembers an explicit dismissal for a month", async () => {
    const { container } = await showRibbon();
    await openRibbon();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    });

    expect(window.localStorage.getItem(INSTALL_DISMISSAL_KEY)).toBeTruthy();
    expect(container.querySelector('[data-ribbon="install"]')).toBeNull();
  });

  it("does not open by itself twice in one session", async () => {
    const first = await showRibbon();
    await openRibbon();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_VISIBLE_MS + 10);
    });
    first.unmount();

    const second = render(<InstallAffordance pathname="/owner/members" />);
    fireInstallEvent();
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });

    // The session remembers the offer: it never opens by itself again.
    expect(window.sessionStorage.getItem(INSTALL_OFFER_SHOWN_KEY)).toBeTruthy();
    const root = second.container.querySelector('[data-ribbon="install"]');
    expect(root).not.toBeNull();
    expect(
      second.container
        .querySelector('button[aria-label="Install options"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
  });

  it("gives iOS accurate Add to Home Screen guidance instead of a fake install button", async () => {
    setUserAgent(IPHONE_UA);
    const { container } = render(<InstallAffordance pathname="/coach" />);
    await act(async () => {
      vi.advanceTimersByTime(INSTALL_OFFER_DELAY_MS + 10);
    });
    await openRibbon();

    expect(screen.getByText(/add to home screen/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^install aqua$/i })).toBeNull();
    expect(container.querySelector('[data-ribbon="install"]')).not.toBeNull();
  });
});
