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
  requirePagePermission: (ctx: unknown) => ctx,
}));

// W1-6 continuation — the page resolves the facility choice from the
// URL and the cookie; no request scope exists in jsdom.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
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
  // The retention action returns the report: the four aggregate
  // numbers plus the evidence behind them (owner UX audit
  // 2026-10-24).
  getRetentionViewAction.mockResolvedValue({
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
    expect(text).toContain("Collections");
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
      "Collections",
      "Revenue by plan",
      "Enquiry funnel",
      // The retention card carries the approved factual heading
      // ("Attendance records to review", human decision of 30 October
      // 2026), not the withdrawn "Retention" title.
      "Attendance records to review",
      "Coach load",
      "Facility utilisation",
    ]) {
      expect(text).toContain(heading);
    }
  });

  it("groups the key-report cards into two independent stacks in one reading order", async () => {
    resolveAllBut("resolve");

    render(await ReportsPage({}));

    const key = document.querySelector("[data-report-key]");
    expect(key).not.toBeNull();
    const stacks = Array.from(key!.children);
    // Two independent stacks. A single grid row takes the height of its
    // tallest card, so the short coach-load card left a large hole
    // under the tall enquiry funnel at 1280x900.
    expect(stacks).toHaveLength(2);
    expect(stacks[0]!.children).toHaveLength(2);
    expect(stacks[1]!.children).toHaveLength(2);
    // One reading order, shared by the phone and the desktop: money,
    // attendance, then the demand behind them and the team that
    // delivers it.
    const order = Array.from(key!.querySelectorAll("h2")).map((heading) =>
      (heading.textContent ?? "").trim(),
    );
    expect(order).toEqual([
      "Collections over time",
      "Attendance by batch",
      "Enquiry funnel",
      "Coach load",
    ]);
  });

  it("keeps the key reports in one column when a facility hides the second stack", async () => {
    resolveAllBut("resolve");

    render(
      await ReportsPage({
        searchParams: Promise.resolve({
          facility: "11111111-1111-4111-8111-111111111111",
        }),
      }),
    );

    const key = document.querySelector("[data-report-key]");
    expect(key).not.toBeNull();
    // The enquiry funnel and the coach load are tenant-wide and are
    // hidden for a facility, so the second stack is not rendered and
    // the first one takes the whole width instead of half of it.
    expect(key!.children).toHaveLength(1);
    const order = Array.from(key!.querySelectorAll("h2")).map((heading) =>
      (heading.textContent ?? "").trim(),
    );
    expect(order).toEqual(["Collections over time", "Attendance by batch"]);
  });

  it("groups the more-reports cards into two independent stacks in a deliberate order", async () => {
    resolveAllBut("resolve");

    render(await ReportsPage({}));

    const more = document.querySelector("[data-report-more]");
    expect(more).not.toBeNull();
    const stacks = Array.from(more!.children);
    // Two independent stacks. A single grid of five cards makes every
    // row as tall as its tallest card, which left an 87px hole under
    // the member mix and a 68px hole under the revenue card at
    // 1280x900 against a declared 20px gap.
    expect(stacks).toHaveLength(2);
    expect(stacks[0]!.querySelectorAll("article")).toHaveLength(2);
    expect(stacks[1]!.querySelectorAll("article")).toHaveLength(3);
    // One reading order, shared by the phone and the desktop: what
    // attendance looked like, who needs a look, then the club's people,
    // revenue and spaces.
    const order = Array.from(more!.querySelectorAll("article h2")).map((heading) =>
      (heading.textContent ?? "").trim(),
    );
    expect(order).toEqual([
      "Attendance trend",
      "Attendance records to review",
      "members mix",
      "Revenue by plan",
      "Facility utilisation",
    ]);
  });
});
