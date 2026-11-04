// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The geometry of the open popup is a pure decision: rectangles in, a
// decision out. It is pinned here because a dropdown that hangs off the
// screen, or opens below a control with no room under it, is a defect
// the browser alone will not report.
import { describe, expect, it } from "vitest";

import {
  SELECT_POPUP_MAX_HEIGHT,
  computeSelectBounds,
  type Rect,
} from "@/components/ui/select-geometry";

const VIEWPORT: Rect = { top: 0, right: 1024, bottom: 768, left: 0 };

function trigger(patch: Partial<Rect> = {}): Rect {
  return { top: 100, right: 240, bottom: 148, left: 40, ...patch };
}

describe("the open popup fits the room it has", () => {
  it("opens below the control when there is room", () => {
    const bounds = computeSelectBounds({ trigger: trigger(), visible: VIEWPORT, clip: null });
    expect(bounds.placement).toBe("below");
    expect(bounds.maxHeight).toBe(SELECT_POPUP_MAX_HEIGHT);
  });

  it("opens above the control when there is no room below", () => {
    const bounds = computeSelectBounds({
      trigger: trigger({ top: 700, bottom: 748 }),
      visible: VIEWPORT,
      clip: null,
    });
    expect(bounds.placement).toBe("above");
    expect(bounds.maxHeight).toBe(SELECT_POPUP_MAX_HEIGHT);
  });

  it("never grows taller than the room it was given", () => {
    const bounds = computeSelectBounds({
      trigger: trigger({ top: 300, bottom: 348 }),
      visible: { top: 0, right: 1024, bottom: 400, left: 0 },
      clip: null,
    });
    // There is no room under the control, so the popup opens above it
    // and takes the room THAT side has.
    expect(bounds.placement).toBe("above");
    expect(bounds.maxHeight).toBeLessThanOrEqual(300);
    expect(bounds.maxHeight).toBeGreaterThan(0);
  });

  it("keeps the popup inside the visible area when the control is at the edge", () => {
    const bounds = computeSelectBounds({
      trigger: trigger({ left: 900, right: 1000 }),
      visible: VIEWPORT,
      clip: null,
    });
    const left = 900 + bounds.offset;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + bounds.width).toBeLessThanOrEqual(VIEWPORT.right);
  });

  it("never grows wider than the visible area", () => {
    const wide = computeSelectBounds({
      trigger: trigger({ left: 0, right: 1000 }),
      visible: VIEWPORT,
      clip: null,
    });
    // The popup is the control's own width, so a wide control keeps a
    // wide popup — it is the VISIBLE area, not a token, that caps it.
    expect(wide.width).toBeLessThanOrEqual(VIEWPORT.right - VIEWPORT.left);

    const narrowScreen = computeSelectBounds({
      trigger: trigger({ left: 10, right: 300 }),
      visible: { top: 0, right: 320, bottom: 640, left: 0 },
      clip: null,
    });
    expect(narrowScreen.width).toBeLessThanOrEqual(320);
  });

  it("is exactly as wide as the control, with its edges aligned", () => {
    // A phone field: 358px wide at 16px from the edge.
    const phone = computeSelectBounds({
      trigger: trigger({ left: 16, right: 374 }),
      visible: { top: 0, right: 390, bottom: 844, left: 0 },
      clip: null,
    });
    expect(phone.width).toBe(358);
    expect(phone.offset).toBe(0);

    // A wide desktop field.
    const desktop = computeSelectBounds({
      trigger: trigger({ left: 40, right: 680 }),
      visible: VIEWPORT,
      clip: null,
    });
    expect(desktop.width).toBe(640);
    expect(desktop.offset).toBe(0);
  });

  it("is as wide as a narrow control too: a long label wraps inside it", () => {
    // A narrow picker (a time field): the popup is that narrow as
    // well, and the label wraps rather than being cut.
    const narrow = computeSelectBounds({
      trigger: trigger({ left: 20, right: 140 }),
      visible: VIEWPORT,
      clip: null,
    });
    expect(narrow.width).toBe(120);
    expect(narrow.offset).toBe(0);
  });

  it("clamps to the visible area only when the control does not fit it", () => {
    const bounds = computeSelectBounds({
      trigger: trigger({ left: 1000, right: 1400 }),
      visible: VIEWPORT,
      clip: null,
    });
    expect(bounds.width).toBeLessThanOrEqual(VIEWPORT.right - VIEWPORT.left);
    const left = 1000 + bounds.offset;
    expect(left).toBeGreaterThanOrEqual(VIEWPORT.left);
    expect(left + bounds.width).toBeLessThanOrEqual(VIEWPORT.right);
  });

  it("respects a clipping ancestor: the column's box is the real edge", () => {
    const bounds = computeSelectBounds({
      trigger: trigger({ top: 100, bottom: 148 }),
      visible: VIEWPORT,
      // A scrolling column that ends 200px down the screen.
      clip: { top: 0, right: 1024, bottom: 200, left: 0 },
    });
    // The column leaves no room under the control, so the popup opens
    // above it — and stays inside the column.
    expect(bounds.placement).toBe("above");
    expect(bounds.maxHeight).toBeLessThanOrEqual(100);
    expect(bounds.maxHeight).toBeGreaterThan(0);
  });
});
