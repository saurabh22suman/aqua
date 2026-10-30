// What the install ribbon measures of the page around it.
//
// DOM reading only — no state, no rendering, no decisions. The hook
// decides what the numbers mean.
//
// The measurements exist because the ribbon must never cover a row and
// never steal a row's click (the independent Chrome review of 30
// October 2026 found it doing both): it has to know how much room the
// page leaves at its right edge, and what it would land on.

import { RIBBON_HEADER_CLEARANCE, type RibbonRect } from "./install-ribbon-geometry";

/**
 * The width the page is drawn in.
 *
 * `window.innerWidth` is the WINDOW's width. With a classic (space
 * taking) scrollbar it includes the 15px the scrollbar occupies, so it
 * is 15px wider than the area the page is laid out in. A `fixed`
 * element with `right: 0` is placed against the LAYOUT viewport, so
 * Chrome paints it with its right edge at
 * `document.documentElement.clientWidth` — 15px to the left of
 * `innerWidth`.
 *
 * The ribbon is `fixed right-0` (components/pwa/install-ribbon.tsx), so
 * every number that says where it may sit has to be in the layout
 * viewport's coordinates. Measuring `innerWidth` put the collision
 * check 15px to the right of the square Chrome actually painted, and
 * the ribbon's leftmost strip covered what the check had called clear:
 * the staging regression of 30 October 2026, where it sat on a
 * right-aligned payment amount (₹7,540 in Payment mix) at 390×844.
 *
 * A browser without layout (jsdom, a hidden frame) reports no drawable
 * width, and a server has no window at all; both fall back to the
 * window's own width, so the ribbon keeps working.
 */
export function viewportWidth(): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const layout = document.documentElement?.clientWidth;
  if (typeof layout === "number" && Number.isFinite(layout) && layout > 0) {
    return Math.round(layout);
  }
  const inner = window.innerWidth;
  return Number.isFinite(inner) && inner > 0 ? Math.round(inner) : 0;
}

export function viewportHeight(): number {
  if (typeof window === "undefined") return 0;
  return Math.round(window.visualViewport?.height ?? window.innerHeight);
}

/** The sticky chrome above the ribbon: the shell header and the banner. */
export function headerClearance(): number {
  if (typeof document === "undefined") return 0;
  const published = Number.parseFloat(
    window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--app-sticky-offset"),
  );
  const banner = Number.isFinite(published) ? published : 0;
  return RIBBON_HEADER_CLEARANCE + banner;
}

/** The phone's home indicator, measured with a probe element. */
export function safeAreaBottom(): number {
  if (typeof document === "undefined" || !document.body) return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;bottom:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom)";
  document.body.appendChild(probe);
  const measured = Number.parseFloat(window.getComputedStyle(probe).paddingBottom);
  probe.remove();
  return Number.isFinite(measured) ? measured : 0;
}

/**
 * The room the page leaves at its right edge.
 *
 * Where the gutter can hold the 44px tab, the tab sits inside it and
 * covers nothing at all.
 *
 * It is measured in the same coordinates the ribbon is placed in — the
 * width the page is drawn in, not the window's width. With a classic
 * scrollbar, `innerWidth` counts the scrollbar as page room and invents
 * a gutter the page does not have: the tab would then be parked over
 * the content while the dock believed it covered nothing.
 */
export function contentGutter(): number {
  if (typeof document === "undefined") return 0;
  const main = document.querySelector("main");
  if (!main) return 0;
  const right = main.getBoundingClientRect().right;
  if (!Number.isFinite(right) || right <= 0) return 0;
  return Math.max(0, Math.round(viewportWidth() - right));
}

/** Everything on the page a person can press. */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[role="button"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The rectangles the ribbon's tab must not land on. */
export function interactiveRects(root: HTMLElement | null): RibbonRect[] {
  const rects: RibbonRect[] = [];
  for (const element of Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))) {
    if (root && root.contains(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  }
  return rects;
}

/**
 * The text that reaches into the page's right-hand column.
 *
 * A control's box is enough for a control, but a right-aligned LABEL
 * (a status badge, a count) has a box that spans the row while its
 * text does not. The text's own rectangles are what say where it is,
 * so a tab may sit beside a heading instead of on top of it.
 *
 * The rectangles are taken per TEXT NODE, with a Range over that node.
 * A Range over an element's CONTENTS is not the same thing: MDN says it
 * "aggregates the results of calls to Element.getClientRects() for all
 * the elements in the range", so it returns the descendant elements'
 * boxes as well — a full-width card or section would come back as one
 * blocker spanning the page, and the tab would have nowhere left to
 * sit. The independent Chrome run of 30 October 2026 measured exactly
 * that: 398 whole-scope rectangles, zero clear places, against 395
 * per-text-node rectangles with clear places.
 *
 * The ribbon's own text is excluded, and a browser without layout (or
 * without Range rectangles) simply has no text rectangles.
 */
export function textRects(scope: Element | null, root: HTMLElement | null): RibbonRect[] {
  if (!scope || typeof document.createRange !== "function") return [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const rects: RibbonRect[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    const parent = node.parentElement;
    if (text.trim().length > 0 && parent && !(root && root.contains(parent))) {
      const style = window.getComputedStyle(parent);
      if (style.display !== "none" && style.visibility !== "hidden") {
        const range = document.createRange();
        // A browser without layout has no Range rectangles: the ribbon
        // then falls back to the controls alone.
        if (typeof range.getClientRects === "function") {
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.width > 0 && rect.height > 0) {
              rects.push({
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
              });
            }
          }
        }
      }
    }
    node = walker.nextNode();
  }
  return rects;
}

/** Everything the tab must not cover: the controls and the text. */
export function contentRects(root: HTMLElement | null): RibbonRect[] {
  const scope = document.querySelector("main") ?? document.body;
  return [...interactiveRects(root), ...textRects(scope, root)];
}
