// @vitest-environment jsdom
//
// Owner Home — the attendance chart is KEPT, ONCE (31 Oct 2026, tranche 2).
//
// Tranche 1 removed the attendance line chart entirely while it removed
// the DUPLICATES. That removed a capability, not a duplicate: the owner
// could no longer see the daily attendance shape, the seven dated
// buckets, the axis or the unknown gaps.
//
// These assertions are about the USER OUTCOME — one attendance chart on
// the page, in its own operational panel outside Money, with its seven
// dated buckets, its units on the axis, its exact data reachable, and an
// unmarked day shown as UNKNOWN rather than as 0%. They are not class
// snapshots.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

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

// The ECharts island is a lazy client island (desktop only, no JS on a
// phone); the phone chart is server-rendered SVG, so the island is
// stubbed out here and the SVG is what carries the chart outcome.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";

const BRANDING = {
  displayName: "Splash Sports Club",
  shortName: "SSC",
  accent: "marine",
  fallbackDisplayName: "Splash Sports Club",
  fallbackShortName: "SSC",
  initials: "SS",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const ALL_CAN = {
  addMember: true,
  recordPayment: true,
  captureEnquiry: true,
  readFees: true,
  viewSchedule: true,
  readEnquiries: true,
};

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-31",
    todayMarked: 0,
    todayTotal: 0,
    activeMemberCount: 8,
    attendanceThisWeekPct: null,
    activeBatchCount: 1,
    needsAttention: [],
    todaysLanes: [],
    nextClass: null,
    facilityBreakdown: [],
    money: {
      collectedTodayPaise: 2100000,
      collectedTodayCount: 2,
      outstandingPaise: 12600000,
      dueInvoiceCount: 4,
      overduePaise: 12600000,
      overdueInvoiceCount: 4,
      oldestOverdueDays: 12,
    },
    ...overrides,
  } as OwnerDashboardData;
}

/** Seven daily buckets, the Last-7-days default. Day 4 has no marks. */
function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const days = [
    { key: "2026-10-25", label: "Sun 25", fullLabel: "25 Oct 2026" },
    { key: "2026-10-26", label: "Mon 26", fullLabel: "26 Oct 2026" },
    { key: "2026-10-27", label: "Tue 27", fullLabel: "27 Oct 2026" },
    { key: "2026-10-28", label: "Wed 28", fullLabel: "28 Oct 2026" },
    { key: "2026-10-29", label: "Thu 29", fullLabel: "29 Oct 2026" },
    { key: "2026-10-30", label: "Fri 30", fullLabel: "30 Oct 2026" },
    { key: "2026-10-31", label: "Sat 31", fullLabel: "31 Oct 2026" },
  ];
  const collectionBuckets = days.map((day) => ({
    key: day.key,
    label: day.label,
    fullLabel: day.fullLabel,
    cash: 125000,
    digital: 0,
    other: 0,
    totalPaise: 125000,
  }));
  const attendanceBuckets = days.map((day, index) =>
    index === 3
      ? { ...day, present: 0, total: 0, pct: null }
      : { ...day, present: 8, total: 10, pct: 80 },
  );
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonMeaning:
        "Seven-day comparison — these seven calendar days against the seven days before them, to the same elapsed time",
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
      buckets: collectionBuckets,
      groups: [
        { key: "cash", label: "Cash", paise: 875000, count: 70, pct: 100 },
        { key: "digital", label: "Digital", paise: 0, count: 0, pct: 0 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 875000, count: 70, pct: 100 },
        { key: "upi", label: "UPI", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "bank_transfer", label: "Bank transfer", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "card", label: "Card", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "other", label: "Other", group: "other", paise: 0, count: 0, pct: 0 },
      ],
      totalPaise: 875000,
      paymentCount: 70,
      previousTotalPaise: 0,
      previousPaymentCount: 0,
      previousIsZero: true,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "No previous collections in the comparison range",
    },
    attendance: {
      buckets: attendanceBuckets,
      present: 48,
      total: 60,
      pct: 80,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
    ...overrides,
  } as OwnerChartsData;
}

function renderHome(chartsData: OwnerChartsData | null = charts()) {
  return render(
    <><OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={ALL_CAN}
      chartsData={chartsData}
    /><OwnerHomeAttendance data={chartsData} facility={null} /></>,
  );
}

afterEach(cleanup);

describe("legacy attendance component — chart contract", () => {
  it("draws one attendance chart inside the operational attendance panel", () => {
    renderHome();
    const attendance = screen.getByTestId("owner-home-attendance");

    // The chart capability is kept: a line chart of attendance.
    const chartsInPanel = attendance.querySelectorAll('[data-kind="line"]');
    expect(chartsInPanel.length).toBe(1);

    // It is the OPERATIONAL panel, not the Money band.
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.querySelectorAll('[data-kind="line"]').length).toBe(0);
    expect(attendance.closest('[data-testid="owner-home-money-surface"]')).toBeNull();

    // …and there is only ONE attendance chart on the page.
    expect(document.querySelectorAll('[data-kind="line"]').length).toBe(1);
  });

  it("names the measure and carries its unit on the axis", () => {
    renderHome();
    const chart = screen
      .getByTestId("owner-home-attendance")
      .querySelector('[data-kind="line"]')!;
    const label = chart.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/attendance/i);
    expect(label).toMatch(/%/);
    // The unit is on the axis, so the shape is readable without the
    // surrounding prose.
    expect(chart.textContent).toContain("100%");
    expect(chart.textContent).toContain("0%");
  });

  it("keeps the seven dated buckets and the exact data reachable", () => {
    renderHome();
    const attendance = screen.getByTestId("owner-home-attendance");

    const table = within(attendance)
      .getAllByRole("table")
      .find((candidate) =>
        (candidate.querySelector("caption")?.textContent ?? "").match(/attendance/i),
      );
    expect(table).toBeTruthy();

    // Seven actual dates, one row each.
    const rows = table!.querySelectorAll("tbody tr");
    expect(rows.length).toBe(7);
    const bodyText = table!.textContent ?? "";
    for (const day of [
      "25 Oct 2026",
      "26 Oct 2026",
      "27 Oct 2026",
      "28 Oct 2026",
      "29 Oct 2026",
      "30 Oct 2026",
      "31 Oct 2026",
    ]) {
      expect(bodyText).toContain(day);
    }
    // The exact marks and the percentage are reachable.
    expect(bodyText).toContain("80%");
  });

  it("shows an unmarked day as unknown, not as 0%", () => {
    renderHome();
    const attendance = screen.getByTestId("owner-home-attendance");
    const table = within(attendance)
      .getAllByRole("table")
      .find((candidate) =>
        (candidate.querySelector("caption")?.textContent ?? "").match(/attendance/i),
      )!;

    const unmarkedRow = Array.from(table.querySelectorAll("tbody tr")).find((row) =>
      (row.textContent ?? "").includes("28 Oct 2026"),
    )!;
    expect(unmarkedRow.textContent).toMatch(/no marks recorded/i);
    expect(unmarkedRow.textContent).not.toMatch(/\b0%\b/);
  });
});

describe("owner Home — money and attendance do not share an error", () => {
  it("names only financial figures when the money band is unavailable", () => {
    renderHome(null);
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.textContent ?? "").not.toMatch(/attendance/i);
    expect(money.textContent ?? "").toMatch(/collections|payment mix/i);
  });

  it("gives attendance its own unavailable message", () => {
    renderHome(null);
    const attendance = screen.getByTestId("owner-home-attendance");
    expect(attendance.textContent ?? "").toMatch(/attendance/i);
    expect(attendance.textContent ?? "").toMatch(/could not be read|unavailable/i);
    // It is not the money band's sentence repeated.
    const money = screen.getByTestId("owner-home-money-surface");
    expect(attendance.textContent).not.toBe(money.textContent);
  });
});
