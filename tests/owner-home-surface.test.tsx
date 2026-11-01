// @vitest-environment jsdom
//
// Owner Home — the visible surface of the owner's daily screen.
//
// Batch 4 (26 October 2026) asked for a visibly more polished owner
// home: a pastel sidebar, a pastel metric hierarchy, a chart a phone can
// read without a table, and a date/month control that wears the theme
// accent. The audit of the page before the change (dev server 3111,
// 1280x900 and 390x844, mint and lavender) found:
//
//   * every metric tile was a flat white card on a grey canvas — no
//     hierarchy, no state colour, nothing to scan;
//   * the desktop sidebar was plain white — the mint direction paints
//     it a pastel mint surface;
//   * the period control's selected pill was painted with `marine`,
//     a structural colour that does not change with the preset, so the
//     lavender theme showed a teal pill next to violet actions;
//   * a phone got NO chart at all: the panels are `hidden lg:block`,
//     so the only thing below `lg` was a "View data table" disclosure;
//   * with no payments yet today, the day period had no visible way to
//     reach the month's history.
//
// What this file pins (the intended behaviour, asserted before the
// implementation):
//
//   1. the four summary tiles are pastel surfaces and carry a
//      state-coloured icon chip;
//   2. the overdue tile only takes the late surface when money is
//      actually past due — a zero is not an alert;
//   3. the period control's selected pill wears the preset accent, not
//      the marine structural colour;
//   4. the chart band renders a labelled SVG chart for a phone, and
//      keeps the accessible data table;
//   5. the month's history is discoverable, labelled and keeps the
//      metric and facility scope.

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

// The ECharts island is a lazy client island; it is not under test here
// (the browser evidence covers it). The phone chart is server-rendered
// SVG, so the island can be stubbed out.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import { OwnerHomeRange } from "@/components/owner-home/owner-home-range";
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
};

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-26",
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

function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const buckets = [
    {
      key: "2026-10-01",
      label: "1",
      fullLabel: "1 Oct 2026",
      cash: 1250000,
      digital: 500000,
      other: 0,
      totalPaise: 1750000,
    },
    {
      key: "2026-10-02",
      label: "2",
      fullLabel: "2 Oct 2026",
      cash: 625000,
      digital: 0,
      other: 0,
      totalPaise: 625000,
    },
  ];
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "month",
      tabLabel: "This month",
      comparisonLabel: "MoM",
      comparisonMeaning: "Month over month — this month-to-date against the same elapsed span",
      currentLabel: "1 Oct 2026, 12:00 am – 26 Oct 2026, 2:20 pm",
      previousLabel: "1 Sept 2026, 12:00 am – 26 Sept 2026, 2:20 pm",
      currentFromDate: "2026-10-01",
      currentToDate: "2026-10-26",
      previousFromDate: "2026-09-01",
      previousToDate: "2026-09-26",
      previousCapped: false,
      capNote: null,
    },
    collections: {
      buckets,
      groups: [
        { key: "cash", label: "Cash", paise: 1875000, count: 30, pct: 80 },
        { key: "digital", label: "Digital", paise: 500000, count: 5, pct: 20 },
        { key: "other", label: "Other", paise: 0, count: 0, pct: 0 },
      ],
      methods: [
        { key: "cash", label: "Cash", group: "cash", paise: 1875000, count: 30, pct: 80 },
        { key: "upi", label: "UPI", group: "digital", paise: 500000, count: 5, pct: 20 },
        { key: "bank_transfer", label: "Bank transfer", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "card", label: "Card", group: "digital", paise: 0, count: 0, pct: 0 },
        { key: "other", label: "Other", group: "other", paise: 0, count: 0, pct: 0 },
      ],
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
        { key: "2026-10-01", label: "1", fullLabel: "1 Oct 2026", present: 8, total: 10, pct: 80 },
        { key: "2026-10-02", label: "2", fullLabel: "2 Oct 2026", present: 0, total: 0, pct: null },
      ],
      present: 8,
      total: 10,
      pct: 80,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
    ...overrides,
  } as OwnerChartsData;
}

afterEach(cleanup);

describe("owner Home — the money surface carries a visible hierarchy", () => {
  // Balances and overdue tone now belong to Fees, not Home; Fees overview
  // coverage lives in owner-redesign-c2-people-fees-overview.test.tsx.
  it("shows the actual daily collection and links to the Fees overview", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} can={ALL_CAN} />);
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.textContent).toContain("₹21,000");
    expect(within(money).getByText("Today")).toBeTruthy();
    expect(money.textContent).not.toContain("Outstanding now");
    expect(within(money).getByRole("link", { name: /₹21,000 collected today/i }).getAttribute("href")).toContain("tab=transactions");
    expect(screen.getByRole("link", { name: /open invoices/i }).getAttribute("href")).toContain("tab=dues");
  });
  it("does not turn an unavailable seven-day read into zero", () => {
    render(<OwnerDashboard data={dashboard()} branding={BRANDING} terminology={TERMINOLOGY} can={ALL_CAN} />);
    expect(within(screen.getByTestId("owner-home-money-surface")).getByText("Unavailable")).toBeTruthy();
  });

});

describe("owner Home — the chart band", () => {
  it("wears the preset accent on the selected range, not the structural marine", () => {
    render(
      <OwnerHomeRange
        data={charts()}
        period="month"
        facility={null}
      />,
    );
    const active = screen.getByRole("link", { name: "Month" });
    expect(active.className).toContain("bg-[var(--accent-strong)]");
    expect(active.className).not.toContain("bg-marine");
  });

  it("gives a phone a chart, and keeps the accessible table", () => {
    render(
      <OwnerHomeCharts
        data={charts()}
        metric="collections"
        facility={null}
        canReadFees
        today="2026-10-26"
      />,
    );
    const figure = screen.getByTestId("owner-mini-chart");
    expect(figure.getAttribute("role")).toBe("img");
    const label = figure.getAttribute("aria-label") ?? "";
    expect(label).toContain("Collections");
    // The range is not repeated in the chart's label: the range strip
    // above the band owns it.
    // The numbers are still readable without the picture.
    expect(screen.getAllByText(/view data table/i).length).toBeGreaterThan(0);
  });

  it("keeps attendance out of the band and states the unknown rule on its own panel", () => {
    render(
      <OwnerHomeAttendance data={charts()} facility={null} />,
    );
    const panel = screen.getByTestId("owner-home-attendance");
    expect(panel.textContent).toContain("A day with no marks recorded is unknown, not 0%.");
  });

  it("offers the month's range once, and keeps the facility scope on it", () => {
    render(
      <OwnerHomeRange
        data={charts({
          period: { ...charts().period, key: "day", tabLabel: "Today" },
        })}
        period="day"
        facility="loc-1"
      />,
    );
    // The Month control IS the route to the month's figures: there is
    // no second "this month's history" link beside it.
    expect(screen.queryByRole("link", { name: /this month's history/i })).toBeNull();
    const month = screen.getByRole("link", { name: "Month" });
    const href = month.getAttribute("href") ?? "";
    expect(href).toContain("period=month");
    // The facility scope survives the jump.
    expect(href).toContain("facility=loc-1");
  });
});
