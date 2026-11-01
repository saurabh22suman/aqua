// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Adding a staff record creates a DIRECTORY RECORD, not login access;
// the page says so and points at Invitations. The detail page is a small
// read-only profile: staff type and login access, with access managed
// elsewhere.

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

const permissions = new Set(["staff.read", "staff.write", "settings.manage"]);
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions,
    features: new Set<string>(),
    roleKey: "owner",
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/services/curriculum-lead", () => ({
  getCurriculumLeadState: async () => null,
}));
vi.mock("@/components/curriculum-lead-control", () => ({
  CurriculumLeadControl: () => null,
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: async () => [
    {
      id: "staff-1",
      personId: "person-1",
      fullName: "Aanya Rao",
      staffType: "coach",
      userId: "user-1",
      employedOn: "2026-06-01",
    },
  ],
  createStaffAction: async () => ({ ok: true }),
  // The staff record form searches existing people for a directory
  // record. This suite asserts the page copy, so the search is empty.
  searchStaffCandidatesAction: async () => [],
}));

vi.mock("@/lib/actions/staff-invitations", () => ({
  createInvitationAction: async () => ({ ok: true }),
}));

import StaffCreatePage from "@/app/(owner)/owner/staff/new/page";
import StaffDetailPage from "@/app/(owner)/owner/staff/[staffId]/page";

afterEach(cleanup);

describe("owner staff pages", () => {
  it("names directory creation apart from login access", async () => {
    render(await StaffCreatePage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Add staff record" }),
    ).toBeTruthy();
    expect(
      screen.getByText(/login access is managed separately/i),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Invitations" })
        .getAttribute("href"),
    ).toBe("/owner/staff/invitations");
  });

  it("states staff type and login access on the read-only profile", async () => {
    render(await StaffDetailPage({ params: Promise.resolve({ staffId: "staff-1" }) }));

    expect(
      screen.getByRole("heading", { level: 2, name: "Staff details" }),
    ).toBeTruthy();
    expect(screen.getByText("Staff type")).toBeTruthy();
    expect(screen.getByText("Login access")).toBeTruthy();
    expect(screen.getByText("Coach")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Manage access in Invitations" })
        .getAttribute("href"),
    ).toBe("/owner/staff/invitations");
  });
});
