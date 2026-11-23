// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner finish lane — report workflows. Each assertion is a user outcome
// that was missing: aggregate rows could not open their own group, a
// focused group could not be cleared or kept while changing range, a
// failed read offered no retry, key totals were buried in a disclosure,
// and a custom/invalid range left the owner on a dead end.

const ids = {
  alpha: "11111111-1111-4111-8111-111111111111",
  beta: "22222222-2222-4222-8222-222222222222",
  north: "33333333-3333-4333-8333-333333333333",
};

const mocks = vi.hoisted(() => ({
  attendance: vi.fn(),
  batchReport: vi.fn(),
  members: vi.fn(),
  staff: vi.fn(),
  charts: vi.fn(),
  enquiry: vi.fn(),
  retention: vi.fn(),
  coach: vi.fn(),
  utilisation: vi.fn(),
  money: vi.fn(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set([
      "reports.operational",
      "reports.financial",
      "invoices.read",
      "programs.read",
      "staff.attendance",
    ]),
    features: new Set(["reports", "billing"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("@/lib/auth/permission", () => ({
  hasFeature: () => true,
  hasPermission: () => true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/lib/actions/owner-insights", () => ({
  getOwnerInsightsAttendanceAction: mocks.attendance,
}));
vi.mock("@/lib/services/owner-batch-report", () => ({
  getOwnerBatchReport: mocks.batchReport,
}));
vi.mock("@/lib/services/owner-people-reports", () => ({
  getMembersReport: mocks.members,
  getStaffReport: mocks.staff,
}));
vi.mock("@/lib/services/owner-home-charts", () => ({
  getOwnerCharts: mocks.charts,
}));
vi.mock("@/lib/actions/owner-reports", () => ({
  getEnquiryFunnelAction: mocks.enquiry,
  getRetentionViewAction: mocks.retention,
  getCoachLoadAction: mocks.coach,
  getFacilityUtilisationAction: mocks.utilisation,
}));
vi.mock("@/lib/actions/owner-analytics", () => ({
  getMoneyAnalyticsAction: mocks.money,
}));
// These are async server components; the page composition is what this
// suite verifies, not their own data rendering.
vi.mock("@/components/reports/enquiry-funnel-card", () => ({
  EnquiryFunnelCard: () => <h2>Enquiry funnel</h2>,
}));
vi.mock("@/components/reports/coach-load-card", () => ({
  CoachLoadCard: () => <h2>Coach load</h2>,
}));

import AttendancePage from "@/app/(owner)/owner/reports/attendance/page";
import BatchesReportPage from "@/app/(owner)/owner/reports/batches/page";
import CollectionsPage from "@/app/(owner)/owner/reports/collections/page";
import MembersReportPage from "@/app/(owner)/owner/reports/members/page";
import ReportsPage from "@/app/(owner)/owner/reports/page";
import StaffReportPage from "@/app/(owner)/owner/reports/staff/page";

function attendanceRow(batchId: string, batchName: string) {
  const marks = { present: 3, late: 1, absent: 0, total: 4 };
  return {
    batchId,
    batchName,
    programName: "Squad",
    locationId: null,
    sessions: 1,
    marks,
    shares: { present: 75, late: 25, absent: 0 },
    register: {
      sessionsWithRoster: 1,
      completedRegisters: 1,
      completionPct: 100,
      rosterSlots: 4,
      markedSlots: 4,
      unmarkedSlots: 0,
    },
  };
}

function attendanceData() {
  return {
    from: "2026-11-01",
    to: "2026-11-08",
    summary: {
      sessions: 2,
      marks: { present: 6, late: 2, absent: 0, total: 8 },
      shares: { present: 75, late: 25, absent: 0 },
      register: {
        sessionsWithRoster: 2,
        completedRegisters: 2,
        completionPct: 100,
        rosterSlots: 8,
        markedSlots: 8,
        unmarkedSlots: 0,
      },
    },
    rows: [attendanceRow(ids.alpha, "Alpha Squad"), attendanceRow(ids.beta, "Beta Squad")],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("attendance report drill-down", () => {
  it("opens each group as a filtered report that keeps the date scope and facility", async () => {
    mocks.attendance.mockResolvedValue(attendanceData());

    render(
      await AttendancePage({
        searchParams: Promise.resolve({
          from: "2026-11-01",
          to: "2026-11-07",
          facility: "all",
        }),
      }),
    );

    const alpha = screen.getByRole("link", { name: "Alpha Squad" });
    expect(screen.getByRole("button", { name: "Reporting range" }).textContent).toContain("1 Nov 2026 – 7 Nov 2026");
    const href = new URL(alpha.getAttribute("href") ?? "", "https://aqua.local");
    expect(href.pathname).toBe("/owner/reports/attendance");
    expect(href.searchParams.get("batch")).toBe(ids.alpha);
    expect(href.searchParams.get("from")).toBe("2026-11-01");
    expect(href.searchParams.get("to")).toBe("2026-11-07");
    expect(href.searchParams.get("facility")).toBe("all");
  });

  it("names the focused group and offers All groups and the same scope on retry", async () => {
    mocks.attendance.mockResolvedValue(attendanceData());

    render(
      await AttendancePage({
        searchParams: Promise.resolve({
          batch: ids.alpha,
          from: "2026-11-01",
          to: "2026-11-07",
          facility: "all",
        }),
      }),
    );

    const focus = screen.getByTestId("attendance-focus");
    expect(focus.textContent).toContain("Alpha Squad");
    expect(focus.textContent).not.toContain("Beta Squad");

    const allGroups = new URL(
      screen.getByRole("link", { name: "All groups" }).getAttribute("href") ?? "",
      "https://aqua.local",
    );
    expect(allGroups.searchParams.get("batch")).toBeNull();
    expect(allGroups.searchParams.get("from")).toBe("2026-11-01");
    expect(allGroups.searchParams.get("facility")).toBe("all");

    const batchField = document.querySelector<HTMLInputElement>(
      'form[action="/owner/reports/attendance"] input[name="batch"]',
    );
    expect(batchField?.value).toBe(ids.alpha);
  });

  it("offers a retry for the same scope when the read fails", async () => {
    mocks.attendance.mockRejectedValue(new Error("temporary"));

    render(
      await AttendancePage({
        searchParams: Promise.resolve({
          batch: ids.alpha,
          from: "2026-11-01",
          to: "2026-11-07",
          facility: "all",
        }),
      }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    const retry = new URL(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href") ?? "",
      "https://aqua.local",
    );
    expect(retry.searchParams.get("batch")).toBe(ids.alpha);
    expect(retry.searchParams.get("from")).toBe("2026-11-01");
  });
});

describe("batches report drill-down", () => {
  const rows = [
    {
      batchId: ids.alpha,
      batchName: "Alpha Squad",
      programName: "Swim",
      locationId: null,
      locationName: "Worli",
      capacity: 12,
      reservedPlaces: 10,
    },
  ];

  it("opens an authorized group from the capacity list", async () => {
    mocks.batchReport.mockResolvedValue(rows);

    render(await BatchesReportPage({ searchParams: Promise.resolve({ facility: "all" }) }));

    expect(screen.getByRole("link", { name: "Alpha Squad" }).getAttribute("href")).toBe(
      `/owner/batches/${ids.alpha}`,
    );
  });

  it("offers a recovery path when the facility selection is invalid", async () => {
    render(
      await BatchesReportPage({ searchParams: Promise.resolve({ facility: "not-a-facility" }) }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/unavailable/i);
    expect(screen.getByRole("link", { name: "Choose all facilities" }).getAttribute("href")).toBe(
      "/owner/reports?facility=all",
    );
  });
});

describe("people report summaries", () => {
  it("states the joined-in-range figure before the daily chart", async () => {
    mocks.members.mockResolvedValue({
      statuses: [{ status: "active", count: 6 }],
      joined: 4,
      joinedUnknown: 2,
      joinedByDay: [{ date: "2026-11-03", count: 4 }],
    });

    render(await MembersReportPage({ searchParams: Promise.resolve({ period: "last7" }) }));

    const summary = screen.getByTestId("members-joined-summary");
    expect(summary.textContent).toContain("4");
    expect(summary.textContent).toMatch(/joined in this range/i);
    expect(summary.textContent).toContain("2");
    expect(summary.textContent).toMatch(/join date unknown/i);
  });

  it("states the recorded check-in and shift totals before the charts", async () => {
    mocks.staff.mockResolvedValue({
      attendance: [
        { date: "2026-11-03", status: "present", locationId: null, checkedIn: true },
        { date: "2026-11-03", status: "present", locationId: null, checkedIn: true },
        { date: "2026-11-04", status: "absent", locationId: null, checkedIn: false },
      ],
      shifts: [
        { date: "2026-11-03", status: "published", locationId: ids.north },
        { date: "2026-11-04", status: "published", locationId: ids.north },
      ],
    });

    render(await StaffReportPage({ searchParams: Promise.resolve({ period: "last7" }) }));

    const summary = screen.getByTestId("staff-summary");
    expect(summary.textContent).toMatch(/recorded check-ins/i);
    expect(summary.textContent).toMatch(/2/);
    expect(summary.textContent).toMatch(/shifts/i);
  });

  it.each([
    ["members", MembersReportPage, "/owner/reports/members"],
    ["staff", StaffReportPage, "/owner/reports/staff"],
  ] as const)("offers a retry for the %s scope when the read fails", async (kind, Page, path) => {
    if (kind === "members") mocks.members.mockRejectedValue(new Error("temporary"));
    else mocks.staff.mockRejectedValue(new Error("temporary"));

    render(await Page({ searchParams: Promise.resolve({ period: "last7", facility: "all" }) }));

    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    const retry = new URL(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href") ?? "",
      "https://aqua.local",
    );
    expect(retry.pathname).toBe(path);
    expect(retry.searchParams.get("period")).toBe("last7");
    expect(retry.searchParams.get("facility")).toBe("all");
  });
});

describe("collections trends recovery", () => {
  it("offers a retry for the same trend scope when the read fails", async () => {
    mocks.charts.mockRejectedValue(new Error("temporary"));

    render(
      await CollectionsPage({
        searchParams: Promise.resolve({ view: "trends", period: "last7", facility: "all" }),
      }),
    );

    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
    const retry = new URL(
      screen.getByRole("link", { name: "Try again" }).getAttribute("href") ?? "",
      "https://aqua.local",
    );
    expect(retry.pathname).toBe("/owner/reports/collections");
    expect(retry.searchParams.get("view")).toBe("trends");
    expect(retry.searchParams.get("period")).toBe("last7");
    expect(retry.searchParams.get("facility")).toBe("all");
  });
});

describe("reports index range recovery", () => {
  function resolveReports() {
    mocks.enquiry.mockResolvedValue([]);
    mocks.retention.mockResolvedValue({
      row: {
        memberCountAtRisk: 0,
        membersWithZeroLast30: 0,
        membersWithPartialLast30: 0,
        totalActiveMembers: 0,
      },
      eligibleMemberCount: 0,
      sessionsInWindow: 0,
      history: "insufficient",
    });
    mocks.coach.mockResolvedValue([]);
    mocks.utilisation.mockResolvedValue({
      fromDate: "2026-11-01",
      toDate: "2026-11-07",
      weeks: 1,
      businessHoursConfigured: false,
      facilities: [],
      byDay: [],
      byHour: [],
      emptiest: null,
    });
    mocks.money.mockResolvedValue({
      collections: { totalPaise: 0, byDay: [], expensesPaise: null, planRevenue: [] },
      planRevenue: [],
    });
  }

  it("offers a standard range when a custom range disables period reports", async () => {
    resolveReports();

    render(
      await ReportsPage({
        searchParams: Promise.resolve({
          from: "2026-11-01",
          to: "2026-11-07",
          facility: "all",
        }),
      }),
    );

    const reset = new URL(
      screen.getByRole("link", { name: "Use Last 7 days" }).getAttribute("href") ?? "",
      "https://aqua.local",
    );
    expect(reset.pathname).toBe("/owner/reports");
    expect(reset.searchParams.get("period")).toBe("last7");
    expect(reset.searchParams.get("facility")).toBe("all");
  });

  it("offers a working reset from an invalid report link", async () => {
    render(await ReportsPage({ searchParams: Promise.resolve({ period: "not-a-period" }) }));

    expect(screen.getByRole("alert").textContent).toMatch(/invalid/i);
    expect(screen.getByRole("link", { name: "Start again" }).getAttribute("href")).toBe(
      "/owner/reports?period=last7&facility=all",
    );
  });
});
