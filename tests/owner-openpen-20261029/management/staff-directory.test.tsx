// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// The reference Team directory is an ALIGNED table on desktop — Staff
// member / Staff type / Login / Employed on / action — with the roster,
// invitations and leave destinations in one toolbar above it. The phone
// keeps identity first instead of shrinking the table.

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
      userId: "user-1",
      employedOn: "2026-06-01",
    },
    {
      id: "staff-2",
      personId: "person-2",
      fullName: "Anil Shah",
      staffType: "accountant",
      userId: null,
      employedOn: "2026-09-12",
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

afterEach(cleanup);

describe("owner staff directory", () => {
  it("renders the directory as an aligned table with the reference columns", async () => {
    render(await StaffListPage());

    const table = screen.getByRole("table", { name: "Team directory" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headers).toEqual([
      "Staff member",
      "Staff type",
      "Login",
      "Employed on",
      "Actions",
    ]);

    expect(within(table).getByText("Aanya Rao")).toBeTruthy();
    expect(within(table).getByText("Coach")).toBeTruthy();
    expect(within(table).getByText("Linked")).toBeTruthy();
    expect(within(table).getByText("Not linked")).toBeTruthy();
    expect(
      within(table).getByRole("link", { name: "Open Aanya Rao" }).getAttribute("href"),
    ).toBe("/owner/staff/staff-1");
  });

  it("keeps the directory, access and roster destinations as separate toolbar entries", async () => {
    render(await StaffListPage());

    for (const [name, href] of [
      ["Roster", "/owner/staff/roster"],
      ["Invitations", "/owner/staff/invitations"],
      ["Leave", "/owner/staff/leave"],
      ["Add staff record", "/owner/staff/new"],
    ] as const) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("href")).toBe(href);
    }
  });
});
