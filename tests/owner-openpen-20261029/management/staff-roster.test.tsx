// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// The roster's working board is a week table — staff down the side, the
// seven days across the top — so a manager can see coverage before
// publishing. Phone keeps the day-by-day list. The toolbar carries the
// week navigation, leave and the check-in poster.

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

const permissions = new Set(["staff.roster"]);
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions,
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
      fullName: "Bhaskar Menon",
      staffType: "coach",
      userId: null,
      employedOn: "2026-07-15",
    },
  ],
}));
vi.mock("@/lib/actions/shifts", () => ({
  listRosterWeekAction: async () => [
    {
      id: "shift-1",
      staffId: "staff-1",
      staffName: "Aanya Rao",
      staffType: "coach",
      locationId: "loc-1",
      shiftDate: "2026-10-26",
      startAt: "2026-10-26T00:30:00.000Z",
      endAt: "2026-10-26T04:30:00.000Z",
      status: "rostered",
      publishedAt: "2026-10-24T04:00:00.000Z",
    },
    {
      id: "shift-2",
      staffId: "staff-2",
      staffName: "Bhaskar Menon",
      staffType: "coach",
      locationId: "loc-1",
      shiftDate: "2026-10-27",
      startAt: "2026-10-27T09:30:00.000Z",
      endAt: "2026-10-27T13:30:00.000Z",
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

describe("owner staff roster", () => {
  it("shows the working week as a staff-by-day table", async () => {
    render(await StaffRosterPage({}));

    expect(
      screen.getByRole("heading", { level: 2, name: "Working week" }),
    ).toBeTruthy();

    const table = screen.getByRole("table", { name: "Working week" });
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent?.trim());
    expect(headers[0]).toBe("Staff");
    expect(headers).toHaveLength(8);

    expect(within(table).getByText("Aanya Rao")).toBeTruthy();
    expect(within(table).getByText("Bhaskar Menon")).toBeTruthy();
    expect(within(table).getAllByText("Published").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Draft").length).toBeGreaterThan(0);
  });

  it("keeps week navigation, leave and the check-in poster in the toolbar", async () => {
    render(await StaffRosterPage({}));

    expect(screen.getByRole("link", { name: "Leave requests" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check-in poster" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous week" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Next week" })).toBeTruthy();
  });
});
