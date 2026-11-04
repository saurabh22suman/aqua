// @vitest-environment jsdom
//
// Owner Home — the per-facility footer is about members (tranche 3,
// 31 Oct 2026).
//
// What the coordinator's Chrome sweep found on /owner: the "By
// facilities" footer printed a SECOND attendance window — a
// Monday-to-now percentage, or "no attendance yet" — beside each
// facility's member count. It is a different window from the
// selected-range attendance panel above, and it reads "no attendance
// yet" even when marks exist on batches that carry no location.
//
// The contract this file pins:
//
//   1. The footer is about ACTIVE MEMBER COUNTS BY FACILITY only.
//      It prints no attendance percentage and no "no attendance yet".
//   2. It speaks the tenant's configured terminology — for the member
//      word and for the facility word.
//   3. The standalone selected-period Attendance panel stays the sole
//      attendance overview, and the detailed reports keep their own
//      data. Nothing here changes a backend read, a join or a
//      location assignment.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import type { BrandingData } from "@/lib/services/branding";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { TerminologyState } from "@/lib/terminology/keys";

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const ALL_CAN = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
  readMembers: true,
  viewTrend: true,
};

const FACILITIES = [
  { locationId: "l1", locationName: "Andheri", activeMembers: 18, attendancePct: 80 },
  { locationId: "l2", locationName: "Demo Main", activeMembers: 7, attendancePct: null },
];

function dashboard(): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: null,
    today: "2026-10-31",
    todayMarked: 16,
    todayTotal: 30,
    activeMemberCount: 25,
    attendanceThisWeekPct: null,
    activeBatchCount: 6,
    needsAttention: [],
    todaysLanes: [],
    nextClass: null,
    facilityBreakdown: FACILITIES,
    money: {
      collectedTodayPaise: 2100000,
      collectedTodayCount: 2,
      outstandingPaise: 12600000,
      dueInvoiceCount: 4,
      overduePaise: 12600000,
      overdueInvoiceCount: 4,
      oldestOverdueDays: 12,
    },
  } as OwnerDashboardData;
}

function charts(): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning: "Seven-day comparison",
      currentLabel: "25 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am",
      previousLabel: "18 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am",
      currentFromDate: "2026-10-25",
      currentToDate: "2026-10-31",
      previousFromDate: "2026-10-18",
      previousToDate: "2026-10-24",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets: [],
      groups: [],
      methods: [],
      totalPaise: 2375000,
      paymentCount: 35,
      previousTotalPaise: 0,
      previousPaymentCount: 0,
      previousIsZero: true,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "No previous collections in the comparison range",
    },
    attendance: {
      buckets: [
        {
          key: "2026-10-31",
          label: "Sat 31",
          fullLabel: "31 Oct 2026",
          present: 8,
          total: 10,
          pct: 80,
        },
      ],
      present: 8,
      total: 10,
      pct: 80,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
  } as OwnerChartsData;
}

function renderHome(
  terminology: TerminologyState = { overrides: {}, locale: "en" },
) {
  return render(
    <OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={terminology}
      can={ALL_CAN}
      chartsData={charts()}
    />,
  );
}

afterEach(cleanup);

describe("owner Home — the per-facility footer is about members", () => {
  it("prints no attendance window beside the member counts", () => {
    renderHome();
    expect(screen.queryByRole("heading", { name: /^by facilities$/i })).toBeNull();
    // The duplicate member tile left Home with the Quick actions box;
    // the invoice shortcut keeps the displayed scope.
    expect(screen.queryByRole("link", { name: /member directory/i })).toBeNull();
    expect(screen.getByRole("link", { name: /record payment/i }).getAttribute("href")).toContain("facility=all");
    expect(screen.getByTestId("owner-home-money-surface").textContent).not.toMatch(/attendance/i);
  });

  it("still states each facility's active member count", () => {
    renderHome();
    expect(FACILITIES.map(({ locationName, activeMembers }) => [locationName, activeMembers])).toEqual([["Andheri", 18], ["Demo Main", 7]]);
    expect(screen.queryByRole("heading", { name: /^by facilities$/i })).toBeNull();
  });

  it("keeps the tenant's terminology-bearing action off Home (its owner is the directory)", () => {
    renderHome();
    // The Add member shortcut left Home, so the tenant's member word
    // is no longer an action label here — the members directory owns
    // it. This is an ABSENCE control, not a terminology proof: the
    // Home's own copy carries the configured word (pinned in
    // tests/owner-light-20261102/home).
    expect(screen.queryByRole("link", { name: /add member/i })).toBeNull();

    cleanup();

    renderHome({
      overrides: {
        member: { en: { one: "swimmer", other: "swimmers" } },
        facility: { en: { one: "centre", other: "centres" } },
      },
      locale: "en",
    });
    expect(screen.queryByRole("link", { name: /add swimmer/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^by centres$/i })).toBeNull();
  });
});

describe("owner Home — attendance keeps one overview", () => {
  it("keeps the selected-period attendance panel and keeps attendance out of Money", () => {
    renderHome();
    expect(screen.queryByTestId("owner-home-attendance")).toBeNull();
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.textContent ?? "").not.toContain("present or late");
    render(<OwnerHomeAttendance data={charts()} facility={null} />);
    const attendance = screen.getByTestId("owner-home-attendance");
    expect(attendance.textContent ?? "").toContain("8 of 10 marks present or late");
    // One attendance summary on the page.
    expect(screen.getAllByTestId("owner-home-attendance")).toHaveLength(1);
  });

  it("does not leak the footer's attendance window into the attendance panel", () => {
    renderHome();
    render(<OwnerHomeAttendance data={charts()} facility={null} />);
    const attendance = screen.getByTestId("owner-home-attendance");
    // The panel reads the SELECTED range, not the footer's window.
    expect(attendance.textContent ?? "").not.toMatch(/this week/i);
    expect(attendance.textContent ?? "").not.toContain("no attendance yet");
  });
});
