// @vitest-environment jsdom
//
// Finance lane — RED (2 Nov 2026): the Reports overview Owner card must use
// the APPROVED MOCK's outline glyph geometry, not a different icon family.
//
// Context. The human rejected the baseline screenshot's icon pack. The
// ICON-ADDENDUM (2 Nov 2026) now requires the exact mock outline geometry —
// 24x24 viewBox, fill none, stroke currentColor, stroke-width 1.8, round
// caps/joins — delivered through ONE shared typed component that Foundation
// owns (components/owner-ui/owner-icon.tsx). This lane consumes that shared
// component after the reviewed transfer; it must not ship a local icon map
// or a duotone substitute.
//
// This file is a READ-ONLY reference test for the one Reports overview card
// this lane owns. It pins the approved geometry for that card and, until the
// shared component is transferred, records the ACTUAL mismatch in the
// rendered output (not in a source string).
//
// Reference: approved mock khelsuite-owner-light-type-mock.html
// (sha256 3bd4a5533ba345fb1daaad15761e8646df2993c6a57be94ce45960f523c5bca5),
// ICONS.members at lines 646-672. The geometry below is a read-only
// reference to that artifact — the shipped icon set stays Foundation's
// shared OwnerIcon.
//
// RED today: the tile renders Lucide `users` — stroke-width 2 with a
// different path set — so the approved-geometry assertions fail.
// GREEN target: the shared OwnerIcon renders the mock geometry below.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { OverviewTile } from "@/components/reports/owner-approved/overview-cards";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

// The approved mock's `members` glyph (ICONS.members), inlined as a
// READ-ONLY reference to the approved artifact — never as a shipped icon set.
const APPROVED_MEMBERS = {
  circle: { cx: "9.5", cy: "8", r: "3.4" },
  paths: [
    "M3.5 19.5v-1a4.4 4.4 0 0 1 4.4-4.4h3.2a4.4 4.4 0 0 1 4.4 4.4v1",
    "M17 5.2a3.4 3.4 0 0 1 0 6.6",
    "M20.5 19.5v-1a4.4 4.4 0 0 0-2.6-4",
  ],
} as const;

function renderMembersTile() {
  const view = render(
    <OverviewTile
      icon="members"
      title="Members"
      value="7"
      detail="2 joined in range · active now"
      href="/owner/reports/members?period=last7&facility=all"
      tone="info"
    />,
  );
  const svg = view.container.querySelector("svg");
  expect(svg, "the tile renders an icon glyph").not.toBeNull();
  return { svg: svg as SVGSVGElement, view };
}

afterEach(cleanup);

describe("Reports overview card icon geometry (approved mock outline)", () => {
  it("draws the approved mock `members` outline, not another icon family", () => {
    const { svg } = renderMembersTile();

    // The approved mock's icon() contract: one 24x24 outline canvas.
    expect(svg.getAttribute("viewBox"), "approved icon viewBox").toBe("0 0 24 24");
    expect(svg.getAttribute("fill"), "approved icon fill").toBe("none");
    expect(svg.getAttribute("stroke"), "approved icon stroke").toBe("currentColor");
    expect(
      svg.getAttribute("stroke-width"),
      "approved icon stroke width (the mock uses 1.8, not the Lucide default 2)",
    ).toBe("1.8");
    expect(svg.getAttribute("stroke-linecap"), "approved icon line cap").toBe("round");
    expect(svg.getAttribute("stroke-linejoin"), "approved icon line join").toBe("round");

    // The approved geometry itself: one head circle plus three body paths.
    const circles = Array.from(svg.querySelectorAll("circle"));
    expect(circles, "approved members head circle").toHaveLength(1);
    expect(circles[0]!.getAttribute("cx")).toBe(APPROVED_MEMBERS.circle.cx);
    expect(circles[0]!.getAttribute("cy")).toBe(APPROVED_MEMBERS.circle.cy);
    expect(circles[0]!.getAttribute("r")).toBe(APPROVED_MEMBERS.circle.r);

    const drawn = Array.from(svg.querySelectorAll("path")).map((path) =>
      path.getAttribute("d"),
    );
    for (const expected of APPROVED_MEMBERS.paths) {
      expect(drawn, `approved members path ${expected}`).toContain(expected);
    }
  });

  it("keeps the card's own words and destination independent of the glyph", () => {
    const { view } = renderMembersTile();

    // The glyph never carries meaning: the card's words and its link do.
    expect(view.getByRole("heading", { name: "Members" })).toBeTruthy();
    expect(view.getByText("7")).toBeTruthy();
    expect(view.getByText("2 joined in range · active now")).toBeTruthy();
    const link = view.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      "/owner/reports/members?period=last7&facility=all",
    );
    expect(link.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws the glyph with vector primitives only", () => {
    const { svg } = renderMembersTile();

    // No raster image, script or injected foreign content inside the glyph.
    expect(svg.querySelector("image")).toBeNull();
    expect(svg.querySelector("script")).toBeNull();
    expect(svg.querySelector("foreignObject")).toBeNull();
    const allowed = new Set(["path", "circle", "rect", "line", "polyline", "polygon"]);
    for (const child of Array.from(svg.children)) {
      expect(allowed.has(child.tagName.toLowerCase())).toBe(true);
    }
  });

  it("has the approved geometry available in the shared OwnerIcon", () => {
    // The shared component Foundation transferred (SHARED-TRANSFERS.json,
    // sha256 1e041e96c79abd6fa0bd988525dd0974461ef5846d37ba6c04338dcdcaf578d4)
    // already carries the approved mock geometry, so this lane consumes it
    // instead of keeping a local copy.
    const { container } = render(<OwnerIcon name="members" />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.8");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");

    const circle = svg.querySelector("circle")!;
    expect(circle.getAttribute("cx")).toBe(APPROVED_MEMBERS.circle.cx);
    expect(circle.getAttribute("cy")).toBe(APPROVED_MEMBERS.circle.cy);
    expect(circle.getAttribute("r")).toBe(APPROVED_MEMBERS.circle.r);

    const drawn = Array.from(svg.querySelectorAll("path")).map((path) =>
      path.getAttribute("d"),
    );
    for (const expected of APPROVED_MEMBERS.paths) {
      expect(drawn).toContain(expected);
    }
  });
});
