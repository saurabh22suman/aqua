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
    permissions: new Set(["reports.financial", "reports.operational"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));

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
  it("leads with the two catalogue shortcuts and four key report surfaces", async () => {
    render(await ReportsPage({}));

    expect(
      screen.getByRole("link", { name: "Daily collections" }).getAttribute("href"),
    ).toBe("/owner/reports/collections");
    expect(
      screen.getByRole("link", { name: "Fees & payments" }).getAttribute("href"),
    ).toBe("/owner/fees");

    const key = screen.getByRole("region", { name: "Key reports" });
    for (const heading of [
      "Collections over time",
      "Attendance by batch",
      "Current enquiry stages",
      "Coach load",
    ]) {
      expect(
        within(key).getByRole("heading", { level: 2, name: heading }),
      ).toBeTruthy();
    }
  });

  it("keeps the supporting reports reachable below the key grid", async () => {
    render(await ReportsPage({}));

    for (const heading of [
      "Attendance trend",
      "Revenue by plan",
      // The approved 30 October 2026 wording: the card counts
      // attendance RECORDS for the period. A member with no mark is
      // unknown — never relabelled absent, never a churn prediction.
      "Attendance records to review",
      "Facility utilisation",
    ]) {
      expect(
        screen.getByRole("heading", { level: 2, name: heading }),
      ).toBeTruthy();
    }
  });
});
