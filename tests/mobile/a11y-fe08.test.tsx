// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 2026-10-05 audit FE-08 — the specific remaining unnamed controls and
// undersized tap targets. Source pins, matching the PR3-C10 sweep's
// mechanical style: they fail if the attribute or size floor is
// removed again.

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
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["staff.read", "settings.manage"]),
    features: new Set<string>(),
    roleKey: "owner",
  }),
  requirePagePermission: (value: unknown) => value,
}));
vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: async () => [
    {
      id: "staff-1",
      personId: "person-1",
      fullName: "Aanya Rao",
      staffType: "coach",
      userId: null,
      employedOn: null,
    },
  ],
}));
vi.mock("@/lib/actions/tenant-owner-reset", () => ({
  listOwnerMembershipsAction: async () => [],
}));
vi.mock("@/components/owner-reset-links", () => ({
  OwnerResetLinks: () => null,
}));

import StaffListPage from "@/app/(owner)/owner/staff/page";

// The shared standard control is 48px; the compact floor is 44px. Read the
// minimum-height token the rendered link actually carries (11 = 44px,
// 12 = 48px, 14 = 56px) so the target-size guarantee follows the control
// contract instead of a frozen class string.
function minHeightPx(className: string): number {
  const match = /(?:^|\s)min-h-(\d+)(?:\s|$)/.exec(className);
  return match ? Number(match[1]) * 4 : 0;
}

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("accessible names (FE-08)", () => {
  it("member search has an accessible name", () => {
    const src = source("components/members-board.tsx");
    expect(src).toMatch(/aria-label="Search members"/);
  });

  it("the enrolment batch selector has an accessible name", () => {
    const src = source("components/member-enrolment-panel.tsx");
    expect(src).toMatch(/aria-label=\{`Select \$\{resolveTerm\(terminology, "batch", 1\)\} to enrol in`\}/);
  });

  it("the void-reason input has an accessible name", () => {
    const src = source("components/member-detail/invoice-expanded.tsx");
    expect(src).toMatch(/aria-label="Reason for voiding"/);
  });
});

describe("tap targets (FE-08)", () => {
  it("renders the three staff navigation actions with names and the 44px floor", async () => {
    render(await StaffListPage());

    for (const [name, href] of [
      ["Roster", "/owner/staff/roster"],
      ["Invitations", "/owner/staff/invitations"],
      ["Leave", "/owner/staff/leave"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
      expect(minHeightPx(link.className)).toBeGreaterThanOrEqual(44);
    }
  });

  it("Confirm reversal carries the 44px floor", () => {
    // The reversal control moved out of invoice-expanded.tsx into its own
    // form component when the invoice panel was split up; the 44px floor
    // follows the button, not the file it used to live in.
    const src = source("components/member-detail/invoice-reversal-form.tsx");
    expect(src).toContain("Confirm reversal");
    expect(src).toMatch(
      /inline-flex min-h-11 items-center justify-center rounded-pill px-3\.5 py-1\.5 text-\[12px\] font-semibold/,
    );
  });
});
