// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR1-C1 — /owner/reports must not blank when one card's data
// source fails. The page awaits its sources with Promise.allSettled
// and renders a named error card in the failed slot.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["reports.financial", "reports.operational"]),
  }),
}));

const getAttendanceReportAction = vi.fn();
const getEnquiryFunnelAction = vi.fn();
const getRetentionViewAction = vi.fn();
const getCoachLoadAction = vi.fn();
const getFacilityUtilisationAction = vi.fn();
vi.mock("@/lib/actions/owner-reports", () => ({
  getAttendanceReportAction: (...args: unknown[]) =>
    getAttendanceReportAction(...args),
  getEnquiryFunnelAction: (...args: unknown[]) => getEnquiryFunnelAction(...args),
  getRetentionViewAction: (...args: unknown[]) => getRetentionViewAction(...args),
  getCoachLoadAction: (...args: unknown[]) => getCoachLoadAction(...args),
  getFacilityUtilisationAction: (...args: unknown[]) =>
    getFacilityUtilisationAction(...args),
  attendanceReportCsvAction: vi.fn(),
}));

const getOperationalAnalyticsAction = vi.fn();
const getMoneyAnalyticsAction = vi.fn();
vi.mock("@/lib/actions/owner-analytics", () => ({
  getOperationalAnalyticsAction: (...args: unknown[]) =>
    getOperationalAnalyticsAction(...args),
  getMoneyAnalyticsAction: (...args: unknown[]) => getMoneyAnalyticsAction(...args),
}));

vi.mock("@/lib/actions/tenant-timezone", () => ({
  getTenantTimezoneAction: async () => "Asia/Kolkata",
}));

vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

// These three cards are async server components (they read the CSV
// action at module scope). jsdom cannot render them, and this suite
// tests the page's settled-loading composition, not the cards.
vi.mock("@/components/reports/attendance-report-card", () => ({
  AttendanceReportCard: () => <h2>Attendance by batch</h2>,
}));
vi.mock("@/components/reports/coach-load-card", () => ({
  CoachLoadCard: () => <h2>Coach load</h2>,
}));
vi.mock("@/components/reports/enquiry-funnel-card", () => ({
  EnquiryFunnelCard: () => <h2>Enquiry funnel</h2>,
}));

import ReportsPage from "@/app/(owner)/owner/reports/page";

const OPERATIONAL = { attendanceTrend: [], memberMix: [] };
const MONEY = {
  collections: { totalPaise: 0, byDay: [], expensesPaise: null },
  planRevenue: [],
};
const UTILISATION = {
  fromDate: "2026-09-01",
  toDate: "2026-09-28",
  weeks: 4,
  businessHoursConfigured: false,
  facilities: [],
  byDay: [],
  byHour: [],
  emptiest: null,
};

function resolveAllBut(money: "resolve" | "reject") {
  getAttendanceReportAction.mockResolvedValue([]);
  getEnquiryFunnelAction.mockResolvedValue([]);
  getRetentionViewAction.mockResolvedValue({
    memberCountAtRisk: 0,
    membersWithZeroLast30: 0,
    membersWithPartialLast30: 0,
    totalActiveMembers: 0,
  });
  getCoachLoadAction.mockResolvedValue([]);
  getFacilityUtilisationAction.mockResolvedValue(UTILISATION);
  getOperationalAnalyticsAction.mockResolvedValue(OPERATIONAL);
  if (money === "reject") {
    getMoneyAnalyticsAction.mockRejectedValue(new Error("42803"));
  } else {
    getMoneyAnalyticsAction.mockResolvedValue(MONEY);
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsPage resilience (PR1-C1)", () => {
  it("renders the other cards and a named error card when money analytics fails", async () => {
    resolveAllBut("reject");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(await ReportsPage({}));

    const text = document.body.textContent ?? "";
    expect(text).toContain("Attendance by batch");
    expect(text).toContain("Attendance trend");
    expect(text).toContain("Enquiry funnel");
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("Collections vs expenses");
    expect(text).toContain("Revenue by plan");
    expect(text).toContain("couldn't load");
    consoleError.mockRestore();
  });

  it("renders every card without an error state when all sources resolve", async () => {
    resolveAllBut("resolve");

    render(await ReportsPage({}));

    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    const text = document.body.textContent ?? "";
    for (const heading of [
      "Attendance by batch",
      "Attendance trend",
      "Collections vs expenses",
      "Revenue by plan",
      "Enquiry funnel",
      "Retention",
      "Coach load",
      "Facility utilisation",
    ]) {
      expect(text).toContain(heading);
    }
  });
});
