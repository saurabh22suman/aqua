// UI foundation — the geometry of an open Menu.
//
// The room a menu may use is the intersection of
//   • the area the user can actually see — the visual viewport, which
//     shrinks when the phone keyboard opens, and
//   • the nearest clipping ancestor's box, when the menu sits inside
//     one (a scrolling column clips its dropdown, so the column's box
//     is the real edge).
//
// Everything that decides something here is pure: rectangles in, a
// decision out. The DOM helpers around it only read layout.

/** A long menu stops growing here and scrolls instead. */
export const MENU_MAX_HEIGHT = 320;
/** A long label wraps here instead of stretching the menu. */
export const MENU_MAX_WIDTH = 320;
/** The narrowest a menu gets, when the screen has room for it. */
export const MENU_MIN_WIDTH = 200;
/** The gap between the trigger and the menu. */
export const MENU_GAP = 4;
/** Under this the menu is too small to open under the trigger. */
export const MENU_MIN_ROOM = 80;

export type Rect = { top: number; right: number; bottom: number; left: number };
export type Side = "start" | "end";
export type Placement = "below" | "above";

export type MenuBounds = {
  /** The tallest the menu may be. Never more than the room it has. */
  maxHeight: number;
  /** The widest the menu may be. */
  maxWidth: number;
  /** Where the menu hangs: under the trigger or above it. */
  placement: Placement;
  /** Which edge of the trigger the menu lines up with. */
  align: Side;
  /** How far the menu moves sideways to stay inside the visible area. */
  offset: number;
};

export type BoundsInput = {
  /** The trigger's box, in viewport coordinates. */
  trigger: Rect;
  /** The area the user can see. */
  visible: Rect;
  /** The nearest clipping ancestor's box, when there is one. */
  clip: Rect | null;
  /** The alignment the caller asked for. */
  align: Side;
};

/** The overlap of two rectangles. */
export function intersect(area: Rect, clip: Rect | null): Rect {
  if (!clip) return area;
  return {
    top: Math.max(area.top, clip.top),
    left: Math.max(area.left, clip.left),
    right: Math.min(area.right, clip.right),
    bottom: Math.min(area.bottom, clip.bottom),
  };
}

/**
 * Where the menu may sit and how big it may be.
 *
 * The room is never padded: a menu taller than the space it has would
 * hang off the screen, so the menu takes the room it is given and
 * scrolls inside it. When there is no usable room under the trigger
 * the menu opens above it instead, and if neither side has room the
 * smaller of the two wins — still inside the screen.
 */
export function computeMenuBounds(input: BoundsInput): MenuBounds {
  const { trigger, visible, clip, align } = input;
  const area = intersect(visible, clip);

  const below = Math.max(0, Math.round(area.bottom - trigger.bottom - MENU_GAP));
  const above = Math.max(0, Math.round(trigger.top - area.top - MENU_GAP));
  const placement: Placement =
    below >= MENU_MIN_ROOM || below >= above ? "below" : "above";
  const maxHeight = Math.min(MENU_MAX_HEIGHT, placement === "below" ? below : above);

  // The width never exceeds the space the menu may use, and the menu
  // never asks for less than its own minimum when there is room for it.
  const available = Math.max(0, Math.round(area.right - area.left - MENU_GAP * 2));
  const maxWidth = Math.max(0, Math.min(MENU_MAX_WIDTH, available));
  const width = Math.min(MENU_MIN_WIDTH, maxWidth);

  // The menu hangs beside the trigger and is then nudged to stay
  // inside: a trigger near a screen edge must not push the menu (and
  // the page's horizontal scrollbar) off the screen. Whichever side
  // needs the smaller move wins; a tie keeps the caller's side.
  const shiftFor = (side: Side) => {
    const left = side === "end" ? trigger.right - width : trigger.left;
    const right = left + width;
    let shift = 0;
    if (right > area.right - MENU_GAP) shift = area.right - MENU_GAP - right;
    if (left + shift < area.left + MENU_GAP) shift = area.left + MENU_GAP - left;
    return shift;
  };
  const other = align === "end" ? "start" : "end";
  const requestedShift = shiftFor(align);
  const otherShift = shiftFor(other);
  const resolved: Side =
    Math.abs(requestedShift) <= Math.abs(otherShift) ? align : other;
  const offset = resolved === align ? requestedShift : otherShift;

  return { maxHeight, maxWidth, placement, align: resolved, offset };
}

/** Is the trigger still inside the area the user can see? */
export function isRectVisible(rect: Rect, visible: Rect, clip: Rect | null): boolean {
  // A box without an area cannot be judged (an element that has not
  // been laid out yet) — it is never treated as "gone".
  if (rect.right <= rect.left || rect.bottom <= rect.top) return true;
  const area = intersect(visible, clip);
  return (
    rect.bottom > area.top &&
    rect.top < area.bottom &&
    rect.right > area.left &&
    rect.left < area.right
  );
}

/** The area the user can see: the visual viewport when the browser has one. */
export function visibleViewportRect(): Rect {
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  if (viewport) {
    const left = viewport.offsetLeft ?? 0;
    const top = viewport.offsetTop ?? 0;
    return {
      top,
      left,
      right: left + viewport.width,
      bottom: top + viewport.height,
    };
  }
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
}

/** The nearest ancestor that clips its content (a scroll column, overflow hidden). */
export function findClipAncestor(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const style = window.getComputedStyle(node);
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
    if (/(auto|scroll|hidden|clip|overlay)/.test(overflow)) return node;
    node = node.parentElement;
  }
  return null;
}

/** The box a clipping ancestor shows, in viewport coordinates. */
export function clipRect(ancestor: HTMLElement | null): Rect | null {
  if (!ancestor) return null;
  const rect = ancestor.getBoundingClientRect();
  const style = window.getComputedStyle(ancestor);
  const top = rect.top + (parseFloat(style.borderTopWidth) || 0);
  const left = rect.left + (parseFloat(style.borderLeftWidth) || 0);
  const right = rect.right - (parseFloat(style.borderRightWidth) || 0);
  const bottom = rect.bottom - (parseFloat(style.borderBottomWidth) || 0);
  return { top, left, right, bottom };
}

/**
 * Watch the screen the menu lives on: a resize, a rotation, the phone
 * keyboard (the visual viewport), a page scroll and the scroll of a
 * clipping column. The returned function removes every listener again —
 * a menu that leaked a resize listener would keep measuring a closed
 * menu for the life of the page.
 */
export function subscribeToViewportChanges(
  ancestor: HTMLElement | null,
  onChange: () => void,
): () => void {
  const viewport = typeof window === "undefined" ? null : window.visualViewport;
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  window.addEventListener("scroll", onChange, { passive: true });
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  ancestor?.addEventListener("scroll", onChange, { passive: true });
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
    window.removeEventListener("scroll", onChange);
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
    ancestor?.removeEventListener("scroll", onChange);
  };
}
