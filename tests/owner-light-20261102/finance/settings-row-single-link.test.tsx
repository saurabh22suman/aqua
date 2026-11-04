// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): an Owner Settings
// destination is still TWO things on screen — a non-clickable name and a
// separate bordered "Open" mini-button — instead of ONE labeled link.
//
// Evidence: the human's actual-Chrome screenshot of the Owner Settings page
// shows 20+ repeated bordered "Open" buttons, one per destination. The
// approved mock draws ONE control per destination row: the row itself
// carries the name, the optional detail and the outline chevron
// (outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html,
// viewSettings(), the `row-btn` rows — source sha256
// 3bd4a5533ba345fb1daaad15761e8646df2993c6a57be94ce45960f523c5bca5).
//
// This test renders the REAL owned component with the REAL production
// destination data (settingCategories()), so every failure below is the
// visible behaviour itself — not a missing module and not an import error.
//
// Controls that must stay meaningful after the change:
//   * every destination keeps its authored href and its test id;
//   * every destination keeps its accessible name ("Open <name>"), so the
//     existing settings-hub expectations still resolve;
//   * a destination the academy has not switched on stays absent (the
//     skill ladder and the booking desk are feature/permission gated);
//   * `hideDetail` still hides the optional detail without hiding the name.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  SettingsSurfaceItems,
  settingCategories,
} from "@/components/settings/settings-surfaces";

afterEach(cleanup);

const ALL_ITEMS = settingCategories({
  ladderEnabled: true,
  multiLocation: true,
  canReadBookings: true,
}).flatMap((category) => category.items);

describe("Owner Settings — one destination, one labeled link", () => {
  it("makes the whole row one link instead of a label plus an Open button", () => {
    render(<SettingsSurfaceItems items={ALL_ITEMS} />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(ALL_ITEMS.length);

    // INTENDED RED today: every destination still paints the word "Open"
    // in its own bordered button.
    expect(screen.queryAllByText("Open")).toHaveLength(0);

    for (const item of ALL_ITEMS) {
      const link = screen.getByRole("link", { name: `Open ${item.label}` });

      // The destination name is INSIDE the link, not beside it.
      expect(link.textContent).toContain(item.label);

      // The outline chevron is inside the link.
      const svg = link.querySelector("svg");
      expect(svg, `${item.label} draws the shared outline chevron`).toBeTruthy();
      expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg?.getAttribute("fill")).toBe("none");
      expect(svg?.getAttribute("stroke")).toBe("currentColor");
      expect(svg?.querySelector("path")?.getAttribute("d")).toBe("m9 5 7 7-7 7");
    }
  });

  it("keeps the optional detail inside the link and still hides it on request", () => {
    render(<SettingsSurfaceItems items={ALL_ITEMS} />);

    const academy = screen.getByRole("link", { name: "Open Academy profile" });
    // INTENDED RED today: the detail sits in a sibling paragraph outside
    // the link, so the link alone does not carry it.
    expect(academy.textContent).toContain(
      "Academy name and billing identity for future invoices.",
    );

    cleanup();
    render(<SettingsSurfaceItems items={ALL_ITEMS} hideDetail />);

    const hidden = screen.getByRole("link", { name: "Open Academy profile" });
    expect(hidden.textContent).toContain("Academy profile");
    expect(hidden.textContent).not.toContain(
      "Academy name and billing identity for future invoices.",
    );
  });

  it("gives the row a 44px target with a visible hover and focus state", () => {
    render(<SettingsSurfaceItems items={ALL_ITEMS} />);

    for (const item of ALL_ITEMS) {
      const link = screen.getByRole("link", { name: `Open ${item.label}` });
      const className = link.getAttribute("class") ?? "";

      // INTENDED RED today: the mini-button carries the 44px target, not
      // the row that holds the name.
      expect(className, `${item.label} has a 44px target`).toMatch(
        /min-h-(11|12|14|\[44px\])/,
      );
      expect(className, `${item.label} shows a hover state`).toContain("hover:");
      expect(className, `${item.label} shows a focus state`).toContain(
        "focus-visible:",
      );
    }
  });

  it("preserves every destination href, test id, accessible name and gate", () => {
    render(<SettingsSurfaceItems items={ALL_ITEMS} />);

    for (const item of ALL_ITEMS) {
      const link = screen.getByRole("link", { name: `Open ${item.label}` });
      expect(link.getAttribute("href")).toBe(item.href);
      if (item.testId) {
        expect(link.getAttribute("data-testid")).toBe(item.testId);
      }
    }

    // The gated destinations stay absent when the academy has not switched
    // the module on or cannot read the booking desk.
    cleanup();
    const ungated = settingCategories({
      ladderEnabled: false,
      multiLocation: false,
      canReadBookings: false,
    }).flatMap((category) => category.items);

    render(<SettingsSurfaceItems items={ungated} />);
    expect(screen.queryByRole("link", { name: "Open Skill ladder" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Bookings" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Academy location" })).toBeTruthy();
  });
});
