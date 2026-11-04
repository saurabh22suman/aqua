// @vitest-environment jsdom
//
// Finance lane — P2 status charts (3 November 2026).
// Intended RED: Members/Staff "Current/Recorded status" are plain text lists;
// the approved direction is a horizontal status bar graph using the SAME
// counts — full accessible labels, exact numbers in details, neutral palette.

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  members: vi.fn(),
  staff: vi.fn(),
  permissions: new Set<string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant",
    userId: "user",
    permissions: s.permissions,
    features: new Set(["reports"]),
    allLocations: true,
    locationIds: [],
  }),
  requirePagePermission: (_ctx: unknown, key: string) => {
    if (!s.permissions.has(key)) throw new Error("denied");
  },
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/services/owner-people-reports", () => ({
  getMembersReport: s.members,
  getStaffReport: s.staff,
}));

import MembersReportPage from "@/app/(owner)/owner/reports/members/page";
import StaffReportPage from "@/app/(owner)/owner/reports/staff/page";

beforeEach(() => {
  s.permissions = new Set(["reports.operational", "staff.attendance"]);
  s.members.mockResolvedValue({
    statuses: [
      { status: "active", count: 42 },
      { status: "paused", count: 5 },
      { status: "lapsed", count: 3 },
    ],
    joined: 4,
    joinedUnknown: 1,
    joinedByDay: [{ date: "2026-10-28", count: 4 }],
  });
  s.staff.mockResolvedValue({
    attendance: [
      { date: "2026-10-28", status: "present", locationId: "loc", checkedIn: true },
      { date: "2026-10-28", status: "absent", locationId: "loc", checkedIn: false },
      { date: "2026-10-29", status: "leave", locationId: "loc", checkedIn: false },
    ],
    shifts: [{ date: "2026-10-28", status: "rostered", locationId: "loc" }],
  });
});
afterEach(cleanup);

describe("status charts", () => {
  it("draws the member status snapshot as horizontal bars with exact values", async () => {
    const { container } = render(
      await MembersReportPage({ searchParams: Promise.resolve({ period: "last7" }) }),
    );
    const bars = container.querySelector('[data-testid="status-bars"]');
    expect(bars, "member status bars exist").not.toBeNull();
    const rows = Array.from(bars!.querySelectorAll("[data-status]"));
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("aria-label")).toMatch(/active/i);
    expect(rows[0].getAttribute("aria-label")).toMatch(/42/);
    // Exact counts stay available in the details disclosure.
    expect(container.textContent).toMatch(/Joined in range: 4/);
  });

  it("draws staff recorded statuses as horizontal bars with exact values", async () => {
    const { container } = render(
      await StaffReportPage({ searchParams: Promise.resolve({ period: "last7" }) }),
    );
    const bars = container.querySelector('[data-testid="status-bars"]');
    expect(bars, "staff status bars exist").not.toBeNull();
    const rows = Array.from(bars!.querySelectorAll("[data-status]"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const labels = rows.map((row) => row.getAttribute("aria-label") ?? "");
    expect(labels.some((label) => /present/i.test(label))).toBe(true);
    expect(labels.some((label) => /leave/i.test(label))).toBe(true);
    // Unrecorded is not absence; the honest note stays.
    expect(container.textContent).toMatch(/Unrecorded is not absence/i);
  });
});
