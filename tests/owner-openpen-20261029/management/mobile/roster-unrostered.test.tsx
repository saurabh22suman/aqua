// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Review finding CR-03 (workflow fidelity).
//
// The roster week table must keep every already-authorized staff member
// visible. A staff member with no shift that week gets empty day cells;
// having one rostered colleague must never hide an unrostered one.

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
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["staff.roster"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));
vi.mock("@/lib/actions/staff", () => ({
  listStaffAction: async () => [
    {
      id: "staff-rostered",
      personId: "person-rostered",
      fullName: "Aanya Rao",
      staffType: "coach",
      userId: "user-1",
      employedOn: "2026-06-01",
    },
    {
      id: "staff-unrostered",
      personId: "person-unrostered",
      fullName: "Rhea Jain",
      staffType: "receptionist",
      userId: null,
      employedOn: "2026-08-01",
    },
  ],
}));
vi.mock("@/lib/actions/shifts", () => ({
  listRosterWeekAction: async () => [
    {
      id: "shift-1",
      staffId: "staff-rostered",
      staffName: "Aanya Rao",
      staffType: "coach",
      locationId: "loc-1",
      shiftDate: "2026-10-26",
      startAt: "2026-10-26T00:30:00.000Z",
      endAt: "2026-10-26T04:30:00.000Z",
      status: "rostered",
      publishedAt: null,
    },
  ],
  listShiftTemplatesAction: async () => [],
  createShiftAction: async () => ({ ok: true }),
  createShiftTemplateAction: async () => ({ ok: true }),
  deleteShiftAction: async () => ({ ok: true }),
  publishRosterAction: async () => ({ ok: true }),
}));

import StaffRosterPage from "@/app/(owner)/owner/staff/roster/page";

afterEach(cleanup);

describe("CR-03 roster keeps unrostered authorized staff visible", () => {
  it("shows one rostered and one unrostered staff member as separate rows", async () => {
    render(await StaffRosterPage({}));

    const table = screen.getByRole("table", { name: "Working week" });
    const rowHeaders = within(table)
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent?.trim());
    expect(rowHeaders).toEqual(["Aanya Rao", "Rhea Jain"]);

    // The unrostered row has empty day cells, not invented shifts.
    const unrosteredRow = within(table)
      .getByRole("rowheader", { name: "Rhea Jain" })
      .closest("tr");
    expect(unrosteredRow).not.toBeNull();
    expect(
      within(unrosteredRow as HTMLElement).getAllByText("—").length,
    ).toBe(7);
  });
});
