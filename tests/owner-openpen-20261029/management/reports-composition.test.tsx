// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Reports leads with the two catalogue shortcuts and a "Key reports"
// grid of four evidence surfaces — collections over time, attendance by
// batch, current enquiry stages and capacity/coach load. Supporting
// cards stay reachable below; a failed source still renders its named
// error card (covered by the existing resilience test).

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
    tenantId: "tenant", userId: "user",
    permissions: new Set(["reports.financial", "reports.operational", "invoices.read", "staff.attendance"]),
    features: new Set(["reports", "billing"]),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsAttendanceAction: async () => ({ summary: { marks: { present: 6, late: 2, absent: 2, total: 10 }, register: { completedRegisters: 1, sessionsWithRoster: 2, unmarkedSlots: 2 } }, rows: [] }) }));
vi.mock("@/lib/services/owner-people-reports", () => ({ getMembersReport: async () => ({ statuses: [{ status: "active", count: 7 }], joined: 2 }), getStaffReport: async () => ({ attendance: [{ checkedIn: true }], shifts: [] }) }));
vi.mock("@/lib/services/owner-batch-report", () => ({ getOwnerBatchReport: async () => [{ reservedPlaces: 4, capacity: 10 }] }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: async () => ({ collections: { paymentCount: 3 } }) }));

vi.mock("@/lib/actions/owner-reports", () => ({
  getAttendanceReportAction: async () => [],
  getEnquiryFunnelAction: async () => [],
  getRetentionViewAction: async () => ({
    row: {
      memberCountAtRisk: 0,
      membersWithZeroLast30: 0,
      membersWithPartialLast30: 0,
      totalActiveMembers: 0,
    },
    eligibleMemberCount: 0,
    sessionsInWindow: 0,
    history: "insufficient",
  }),
  getCoachLoadAction: async () => [],
  getFacilityUtilisationAction: async () => ({
    fromDate: "2026-09-01",
    toDate: "2026-09-28",
    weeks: 4,
    businessHoursConfigured: false,
    facilities: [],
    byDay: [],
    byHour: [],
    emptiest: null,
  }),
  attendanceReportCsvAction: vi.fn(),
}));

vi.mock("@/lib/actions/owner-analytics", () => ({
  getOperationalAnalyticsAction: async () => ({
    attendanceTrend: [],
    memberMix: [],
  }),
  getMoneyAnalyticsAction: async () => ({
    collections: { totalPaise: 0, byDay: [], expensesPaise: null },
    planRevenue: [],
  }),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

// The async report cards resolve their own server reads; this suite
// asserts the page's composition, so each card contributes its heading.
vi.mock("@/components/reports/attendance-report-card", () => ({
  AttendanceReportCard: () => <h2>Attendance by batch</h2>,
}));
vi.mock("@/components/reports/coach-load-card", () => ({
  CoachLoadCard: () => <h2>Coach load</h2>,
}));
vi.mock("@/components/reports/enquiry-funnel-card", () => ({
  EnquiryFunnelCard: () => <h2>Current enquiry stages</h2>,
}));
vi.mock("@/components/reports/attendance-report-card-csv", () => ({}));

import ReportsPage from "@/app/(owner)/owner/reports/page";

afterEach(cleanup);

describe("owner reports composition", () => {
  it("shows its date range without a raw timezone", async () => {
    render(await ReportsPage({}));
    const text = document.body.textContent ?? "";
    expect(text).toContain("All permitted facilities");
    expect(screen.getByText("Last 7 days")).toBeTruthy();
    expect(text).not.toMatch(/Asia\/(Kolkata|Calcutta)/);
  });
  it("leads with the approved operational and financial report surfaces", async () => {
    render(await ReportsPage({}));

    expect(screen.getByRole("link", { name: /attendance/i }).getAttribute("href")).toContain("/owner/reports/attendance?period=last7&facility=all");
    expect(screen.getByRole("link", { name: /payments recorded/i }).getAttribute("href")).toContain("/owner/reports/collections?view=trends&period=last7&facility=all");
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByRole("link", { name: /customize reports/i })).toBeTruthy();
  });

  it("keeps the supporting reports reachable below the key grid", async () => {
    render(await ReportsPage({}));

    const details = screen.getByText("More reports").closest("details")!;
    expect(details.open).toBe(false);
    for (const heading of ["Current enquiry stages", "Coach load", "Attendance records to review", "Facility utilisation", "Collections by membership plan"]) {
      expect(
        within(details).getByRole("heading", { level: 2, name: heading, hidden: true }),
      ).toBeTruthy();
    }
  });
});
