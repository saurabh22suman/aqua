// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// Foundation — the shared Owner icon.
//
// Human correction (2 November 2026, ICON-ADDENDUM.md): the baseline
// screenshot's icons do NOT match the approved mock, so the Owner
// product gets ONE shared typed outline icon set whose geometry is the
// mock's own SVG, exactly:
//
//   viewBox 0 0 24 24, fill none, stroke currentColor,
//   strokeWidth 1.8, round caps and joins, decorative by default.
//
// There is no new npm dependency: the geometry is static React SVG
// children (no dangerouslySetInnerHTML, no raw SVG strings, no scripts,
// no remote fetch).
//
// The reference geometry is the mock's own `var ICONS` map
// (outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html,
// lines 646–672), copied as React elements.

import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";

afterEach(cleanup);

// The mock's exact geometry for the names this test pins.
const MOCK_GEOMETRY: Record<string, string> = {
  home: "M3.5 10.7 12 3.9l8.5 6.8V20a1 1 0 0 1-1 1h-4.6v-5.6h-5.8V21H4.5a1 1 0 0 1-1-1z",
  more: "circle",
  plus: "M12 5v14M5 12h14",
  search: "circle",
};

describe("OwnerIcon — the approved mock geometry", () => {
  it("draws the mock's house for Home, not a grid", () => {
    const { container } = render(<OwnerIcon name="home" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(
      MOCK_GEOMETRY.home,
    );
  });

  it("draws the mock's three circular dots for More", () => {
    const { container } = render(<OwnerIcon name="more" />);
    const svg = container.querySelector("svg");
    const circles = svg?.querySelectorAll("circle") ?? [];
    expect(circles).toHaveLength(3);
    expect(circles[0]?.getAttribute("cx")).toBe("6");
    expect(circles[1]?.getAttribute("cx")).toBe("12");
    expect(circles[2]?.getAttribute("cx")).toBe("18");
    expect(circles[0]?.getAttribute("r")).toBe("1.6");
  });

  it("draws the mock's plus and search", () => {
    const plus = render(<OwnerIcon name="plus" />).container;
    expect(plus.querySelector("path")?.getAttribute("d")).toBe(
      MOCK_GEOMETRY.plus,
    );
    const search = render(<OwnerIcon name="search" />).container;
    expect(search.querySelector("circle")?.getAttribute("r")).toBe("6");
    expect(search.querySelector("path")?.getAttribute("d")).toBe(
      "m15.5 15.5 4 4",
    );
  });

  it("draws every agreed name with real geometry", () => {
    const names: OwnerIconName[] = [
      "home",
      "members",
      "calendar",
      "more",
      "invoice",
      "booking",
      "programs",
      "enquiry",
      "staff",
      "reports",
      "settings",
      "money",
      "userplus",
      "alert",
      "search",
      "check",
      "chevron",
      "down",
      "left",
      "bell",
      "wifi",
      "lock",
      "pin",
      "plus",
      "info",
    ];
    for (const name of names) {
      const { container, unmount } = render(<OwnerIcon name={name} />);
      const svg = container.querySelector("svg");
      expect(
        svg?.childElementCount,
        `${name} must draw geometry`,
      ).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe("OwnerIcon — the shared drawing contract", () => {
  it("is a 24×24 outline box with the shared stroke", () => {
    const { container } = render(<OwnerIcon name="home" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    expect(svg?.getAttribute("stroke-linecap")).toBe("round");
    expect(svg?.getAttribute("stroke-linejoin")).toBe("round");
  });

  it("defaults to 20px and takes the caller's size", () => {
    const { container } = render(<OwnerIcon name="home" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("20");
    expect(svg?.getAttribute("height")).toBe("20");

    const bigger = render(<OwnerIcon name="home" size={22} />).container;
    expect(bigger.querySelector("svg")?.getAttribute("width")).toBe("22");
    expect(bigger.querySelector("svg")?.getAttribute("height")).toBe("22");
  });

  it("is decorative by default and named by a title when it stands alone", () => {
    const decorative = render(<OwnerIcon name="home" />).container;
    expect(decorative.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );

    const named = render(<OwnerIcon name="home" title="Home" />).container;
    const svg = named.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
    expect(svg?.getAttribute("role")).toBe("img");
    expect(named.querySelector("title")?.textContent).toBe("Home");
  });

  it("carries the caller's class", () => {
    const { container } = render(
      <OwnerIcon name="home" className="owner-icon" />,
    );
    expect(container.querySelector("svg")?.getAttribute("class")).toBe(
      "owner-icon",
    );
  });
});
