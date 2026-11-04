// UI foundation — the geometry of an open select popup.
//
// The room a popup may use is the intersection of
//   • the area the user can actually see — the visual viewport, which
//     shrinks when the phone keyboard opens, and
//   • the nearest clipping ancestor's box, when the popup sits inside
//     one (a scrolling column clips its dropdown, so the column's box
//     is the real edge).
//
// The DOM helpers that read the layout live in menu-bounds.ts and are
// shared with the Menu; only the decision is select-specific: a popup
// hangs UNDER the control (or above it, when there is no room), it is
// as wide as the control but never wider than the screen, and it is
// nudged sideways so it stays where the user can see it.
//
// Everything that decides something here is pure: rectangles in, a
// decision out.

import { intersect, type Rect } from "./menu-bounds";

export type { Rect };

/** A popup stops growing here and scrolls instead. */
export const SELECT_POPUP_MAX_HEIGHT = 320;
/** The gap between the control and the popup. */
export const SELECT_POPUP_GAP = 4;
/** Under this the popup is too small to open under the control. */
export const SELECT_POPUP_MIN_ROOM = 80;

export type SelectPlacement = "below" | "above";

export type SelectBounds = {
  /** The tallest the popup may be. Never more than the room it has. */
  maxHeight: number;
  /** How wide the popup is. */
  width: number;
  /** Where the popup hangs: under the control or above it. */
  placement: SelectPlacement;
  /** How far the popup moves sideways to stay inside the visible area. */
  offset: number;
};

export type SelectBoundsInput = {
  /** The control's box, in viewport coordinates. */
  trigger: Rect;
  /** The area the user can see. */
  visible: Rect;
  /** The nearest clipping ancestor's box, when there is one. */
  clip: Rect | null;
};

/**
 * Where the popup may sit and how big it may be.
 *
 * The room is never padded: a popup taller than the space it has would
 * hang off the screen, so it takes the room it is given and scrolls
 * inside it. When there is no usable room under the control the popup
 * opens above it instead.
 */
export function computeSelectBounds(input: SelectBoundsInput): SelectBounds {
  const { trigger, visible, clip } = input;
  const area = intersect(visible, clip);

  const below = Math.max(0, Math.round(area.bottom - trigger.bottom - SELECT_POPUP_GAP));
  const above = Math.max(0, Math.round(trigger.top - area.top - SELECT_POPUP_GAP));
  const placement: SelectPlacement =
    below >= SELECT_POPUP_MIN_ROOM || below >= above ? "below" : "above";
  const maxHeight = Math.min(
    SELECT_POPUP_MAX_HEIGHT,
    placement === "below" ? below : above,
  );

  // The popup is the CONTROL's width: a dropdown that is narrower than
  // the field it belongs to does not read as belonging to it (the human
  // reported exactly that, 30 October 2026). Its left and right edges
  // line up with the field's, and a long label wraps inside it.
  //
  // Only a control that does not fit the visible area is clamped, and
  // then the popup takes the room it has.
  const controlWidth = Math.max(0, Math.round(trigger.right - trigger.left));
  const available = Math.max(0, Math.round(area.right - area.left));
  const width = Math.min(controlWidth, available);

  // The popup hangs under the control's left edge; it is only nudged
  // when the control itself does not fit where the user can see.
  let offset = 0;
  if (trigger.left + width > area.right) {
    offset = area.right - (trigger.left + width);
  }
  if (trigger.left + offset < area.left) {
    offset = area.left - trigger.left;
  }

  return { maxHeight, width, placement, offset };
}
