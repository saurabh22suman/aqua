// @vitest-environment jsdom
//
// Owner light · People lane (2 November 2026) — the Owner-only glyphs.
//
// ICON-ADDENDUM.md (human correction, 2 Nov 2026): the Owner surfaces
// must draw the APPROVED MOCK's own outline geometry, exactly — not an
// approximate filled/duotone Khel glyph and not a different symbol.
//
// The approved reference is `var ICONS` in
// outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html
// (lines 646–672), drawn by the mock's `icon()` helper (line 673):
//
//   viewBox 0 0 24 24 · fill none · stroke currentColor
//   stroke-width 1.8 · round caps and joins · aria-hidden true
//
// The shared set is the foundation's `components/owner-ui/owner-icon.tsx`
// (OwnerIcon). This file proves the OWNER-ONLY glyphs in the People lane
// actually draw that geometry — it renders the surfaces and reads the
// SVG out of the DOM, so it is rendered evidence, not a source scan.
//
// SCOPE: only OWNER-ONLY surfaces are asserted here. A component that
// also serves reception or coach keeps its current appearance; see the
// handoff for the documented mappings that were deliberately kept.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/people", () => ({
  listMembersAction: vi.fn(async () => []),
}));

vi.mock("@/lib/actions/staff", () => ({
  searchStaffCandidatesAction: vi.fn(async () => []),
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["staff.read", "staff.write"]),
    features: new Set(["staff"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));

import { MembersBoard } from "@/components/members-board";
import { MemberProfileSections } from "@/components/member-detail/member-profile-sections";
import StaffNewPage from "@/app/(owner)/owner/staff/new/page";

const TERMINOLOGY = { locale: "en", overrides: {} } as never;

/** The mock's `icon()` contract, asserted on the rendered SVG. */
function expectApprovedOutline(svg: SVGSVGElement | null) {
  expect(svg, "the surface draws no glyph at all").toBeTruthy();
  const el = svg!;
  expect(el.getAttribute("viewBox")).toBe("0 0 24 24");
  expect(el.getAttribute("fill")).toBe("none");
  expect(el.getAttribute("stroke")).toBe("currentColor");
  expect(el.getAttribute("stroke-width")).toBe("1.8");
  expect(el.getAttribute("stroke-linecap")).toBe("round");
  expect(el.getAttribute("stroke-linejoin")).toBe("round");
  expect(el.getAttribute("aria-hidden")).toBe("true");
  expect(el.getAttribute("class") ?? "").not.toContain("lucide");
}

/** The exact child geometry of the mock's glyph. */
function geometry(svg: SVGSVGElement) {
  return {
    paths: Array.from(svg.querySelectorAll("path")).map((p) =>
      p.getAttribute("d"),
    ),
    circles: Array.from(svg.querySelectorAll("circle")).map((c) =>
      [c.getAttribute("cx"), c.getAttribute("cy"), c.getAttribute("r")].join(","),
    ),
    rects: Array.from(svg.querySelectorAll("rect")).map((r) =>
      [r.getAttribute("x"), r.getAttribute("y"), r.getAttribute("width"), r.getAttribute("height")].join(","),
    ),
  };
}

afterEach(cleanup);

describe("Owner-only glyphs draw the approved mock's outline", () => {
  it("draws the members search with the mock's magnifier", () => {
    render(
      <MembersBoard
        initialMembers={[]}
        initialLocationId="loc-1"
        navigationNamespace="tenant-1:user-1"
      />,
    );
    const input = screen.getByTestId("members-search");
    const svg = input.parentElement?.querySelector("svg") ?? null;
    expectApprovedOutline(svg);
    expect(svg!.getAttribute("width")).toBe("16");
    expect(svg!.getAttribute("height")).toBe("16");
    expect(geometry(svg!)).toEqual({
      paths: ["m15.5 15.5 4 4"],
      circles: ["11,11,6"],
      rects: [],
    });
  });

  it("draws the guardians heading with the mock's people glyph", () => {
    const member = {
      memberId: "m1",
      fullName: "Aadhya Sharma",
      isMinor: true,
      guardians: [
        {
          personId: "p1",
          fullName: "Meera Sharma",
          relationship: "Mother",
          phone: null,
          isPrimary: true,
        },
      ],
      consents: [],
      statusHistory: [],
    } as never;
    render(
      <MemberProfileSections
        member={member}
        attendanceHistory={{ rows: [], today: "2026-11-02" } as never}
        terminology={TERMINOLOGY}
        sections={["guardians"]}
      />,
    );
    const heading = screen.getByRole("heading", { name: "Guardians" });
    const svg = heading.querySelector("svg");
    expectApprovedOutline(svg);
    expect(svg!.getAttribute("width")).toBe("15");
    expect(geometry(svg!)).toEqual({
      paths: [
        "M3.5 19.5v-1a4.4 4.4 0 0 1 4.4-4.4h3.2a4.4 4.4 0 0 1 4.4 4.4v1",
        "M17 5.2a3.4 3.4 0 0 1 0 6.6",
        "M20.5 19.5v-1a4.4 4.4 0 0 0-2.6-4",
      ],
      circles: ["9.5,8,3.4"],
      rects: [],
    });
  });

  it("draws the staff back link with the mock's left chevron", async () => {
    render(await StaffNewPage());
    const back = screen.getByRole("link", { name: "Staff" });
    const svg = back.querySelector("svg");
    expectApprovedOutline(svg);
    expect(svg!.getAttribute("width")).toBe("16");
    expect(geometry(svg!)).toEqual({
      paths: ["m15 5-7 7 7 7"],
      circles: [],
      rects: [],
    });
  });
});
