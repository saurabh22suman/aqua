// The calendar popup's PLACE.
//
// The popup is drawn in a portal and positioned against the VIEWPORT,
// so it is never clipped by an ancestor and never overflows a narrow
// screen.
//
// It is sized to the CLIENT viewport — the space the page can actually
// use — and not to the window: a classic scrollbar takes the
// difference, and a popup sized to the window runs under it.
//
// It also FOLLOWS the viewport: the popup is measured and placed again
// when the window is resized or the page is scrolled, so it never sits
// where it can no longer be reached.

/** The widest the popup is drawn, and the space it keeps from the edge. */
export const POPUP_MAX_WIDTH = 320;
export const POPUP_MARGIN = 8;

export type CalendarViewport = { width: number; height: number };

export type CalendarAnchor = {
  top: number;
  bottom: number;
  left: number;
};

export type CalendarPopupLayout = {
  top: number;
  left: number;
  width: number;
  /** The height the popup may not grow past: the rest scrolls. */
  maxHeight: number;
};

/** The space the page can use: the client viewport, not the window. */
export function clientViewport(): CalendarViewport {
  if (typeof document === "undefined") return { width: 320, height: 800 };
  const root = document.documentElement;
  const visual = typeof window !== "undefined" ? window.visualViewport : null;
  // The visual viewport is the space the page really has (a mobile
  // keyboard and a pinch-zoom both shrink it). A viewport that reports
  // no size is not one: the document's own client box is used then.
  const visualWidth = visual?.width ?? 0;
  const visualHeight = visual?.height ?? 0;
  const clientWidth = root.clientWidth || window.innerWidth;
  const clientHeight = root.clientHeight || window.innerHeight;
  const width = visualWidth > 0 ? Math.min(visualWidth, clientWidth) : clientWidth;
  const height = visualHeight > 0 ? Math.min(visualHeight, clientHeight) : clientHeight;
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Where the popup is drawn.
 *
 * It is as wide as it can be without leaving the viewport, it starts at
 * the anchor, and it opens ABOVE the anchor when there is no room
 * below. It never grows past the viewport: a calendar that runs off
 * the screen is a calendar nobody can use, so the month scrolls
 * instead.
 */
export function calendarPopupLayout(
  anchor: CalendarAnchor,
  height: number,
  viewport: CalendarViewport,
): CalendarPopupLayout {
  const width = Math.min(
    POPUP_MAX_WIDTH,
    Math.max(200, viewport.width - POPUP_MARGIN * 2),
  );
  const left = Math.min(
    Math.max(POPUP_MARGIN, anchor.left),
    Math.max(POPUP_MARGIN, viewport.width - width - POPUP_MARGIN),
  );
  const available = Math.max(160, viewport.height - POPUP_MARGIN * 2);
  const maxHeight = available;
  const placedHeight = Math.min(height || available, available);
  const below = anchor.bottom + POPUP_MARGIN;
  const fitsBelow = below + placedHeight <= viewport.height - POPUP_MARGIN;
  const top = fitsBelow
    ? below
    : Math.max(POPUP_MARGIN, anchor.top - placedHeight - POPUP_MARGIN);
  return { top, left, width, maxHeight };
}
