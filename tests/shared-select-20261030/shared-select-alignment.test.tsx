// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The human's finding (root's Chrome, 30 October 2026): *"dropdown is
// narrower than its field"*. A dropdown that is narrower than the field
// it belongs to does not read as belonging to it, and it left the
// option list cramped.
//
// The popup is therefore the FIELD's width, with its left and right
// edges lined up with the field's. Only a field that does not fit the
// visible area is clamped.
//
// These are rendered regressions: the popup's own style is read, with
// the control's box stubbed (jsdom has no layout engine, so the box
// the control would have is given here).
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Select } from "@/components/ui/Select";

/** The box the control would have in a real browser. */
function stubControlBox(left: number, right: number, top = 100, bottom = 148) {
  const original = HTMLSelectElement.prototype.getBoundingClientRect;
  HTMLSelectElement.prototype.getBoundingClientRect = function box() {
    return {
      x: left,
      y: top,
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    HTMLSelectElement.prototype.getBoundingClientRect = original;
  };
}

function openPopup() {
  fireEvent.keyDown(screen.getByLabelText("Facility"), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

afterEach(cleanup);

describe("the popup lines up with the field it belongs to", () => {
  it("is the width of a phone field, with its left edge on the field's", () => {
    const restore = stubControlBox(16, 374);
    try {
      render(
        <Select aria-label="Facility">
          <option value="p1">Pool 1</option>
        </Select>,
      );
      const popup = openPopup();
      expect(popup.style.width).toBe("358px");
      // No sideways nudge: the popup starts where the field starts.
      expect(popup.style.marginLeft).toBe("");
    } finally {
      restore();
    }
  });

  it("is the width of a wide desktop field", () => {
    const restore = stubControlBox(40, 680);
    try {
      render(
        <Select aria-label="Facility">
          <option value="p1">Pool 1</option>
        </Select>,
      );
      const popup = openPopup();
      expect(popup.style.width).toBe("640px");
      expect(popup.style.marginLeft).toBe("");
    } finally {
      restore();
    }
  });

  it("is the width of a narrow picker, and a long label wraps inside it", () => {
    const restore = stubControlBox(20, 140);
    try {
      render(
        <Select aria-label="Facility">
          <option value="p1">
            A very long facility name that has to wrap inside the field
          </option>
        </Select>,
      );
      const popup = openPopup();
      expect(popup.style.width).toBe("120px");
      const option = within(popup).getAllByRole("option")[0];
      expect(option?.textContent).toContain("inside the field");
      expect(option?.className).not.toContain("truncate");
    } finally {
      restore();
    }
  });

  it("stays inside the visible area when the field itself does not fit", () => {
    const restore = stubControlBox(1000, 1400);
    try {
      render(
        <Select aria-label="Facility">
          <option value="p1">Pool 1</option>
        </Select>,
      );
      const popup = openPopup();
      const width = Number.parseInt(popup.style.width, 10);
      const margin = Number.parseInt(popup.style.marginLeft || "0", 10);
      expect(width).toBeLessThanOrEqual(1024);
      expect(1000 + margin).toBeGreaterThanOrEqual(0);
      expect(1000 + margin + width).toBeLessThanOrEqual(1024);
    } finally {
      restore();
    }
  });
});
