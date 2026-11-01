// @vitest-environment jsdom
//
// Owner Home — the composition contract for the trend band (31 Oct 2026).
//
// The three defects this file pins, as they were found in the rendered
// source:
//
//   1. ATTENDANCE LIVED INSIDE MONEY. The "Money at a glance" section
//      carried a Collections / Attendance metric switch, so an
//      operational fact sat inside the financial section. Attendance
//      now has its own operational home, outside Money.
//   2. THE SAME FACTS WERE REPEATED. A "see this month's history" link
//      sat next to a Month control that already did the same thing; the
//      panel header, both data-table captions and the payment mix each
//      repeated the range; and the payment mix repeated the comparison
//      the collections panel had already printed. The range, the
//      comparison and the exact instants now have ONE owner each, and
//      the exact ranges/methodology live in an accessible disclosure.
//   3. ATTENDANCE APPEARED TWICE. The chart and the Insights preview
//      (plus its expanded detail) showed attendance. It now appears
//      once, as one concise operational summary with a drill-down.
//
// These assertions are about the RENDERED result, not about class names:
// they read headings, links, control names and the visible text.

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

// The ECharts island is a lazy client island; the phone chart is
// server-rendered SVG, so the island can be stubbed out here.
vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import { OwnerHomeRange } from "@/components/owner-home/owner-home-range";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
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

function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const buckets = [
    {
      key: "2026-10-30",
      label: "Fri 30",
      fullLabel: "30 Oct 2026",
      cash: 1250000,
      digital: 500000,
      other: 0,
      totalPaise: 1750000,
    },
    {
      key: "2026-10-31",
      label: "Sat 31",
      fullLabel: "31 Oct 2026",
      cash: 625000,
      digital: 0,
      other: 0,
      totalPaise: 625000,
    },
  ];
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
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
        { key: "2026-10-30", label: "Fri 30", fullLabel: "30 Oct 2026", present: 8, total: 10, pct: 80 },
        { key: "2026-10-31", label: "Sat 31", fullLabel: "31 Oct 2026", present: 0, total: 0, pct: null },
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

function renderHome(props: {
  chartsData?: OwnerChartsData | null;
  facility?: string | null;
} = {}) {
  return render(
    <><OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={ALL_CAN}
      chartsData={props.chartsData === undefined ? charts() : props.chartsData}
      facility={props.facility ?? null}
    /><OwnerHomeRange data={props.chartsData === undefined ? charts() : props.chartsData} period="last7" facility={props.facility ?? null} /><OwnerHomeCharts data={props.chartsData === undefined ? charts() : props.chartsData} facility={props.facility ?? null} canReadFees /><OwnerHomeAttendance data={props.chartsData === undefined ? charts() : props.chartsData} facility={props.facility ?? null} /></>,
  );
}

afterEach(cleanup);

describe("legacy report components — attendance and money", () => {
  it("keeps an attendance switch out of the Money section", () => {
    renderHome();
    const money = screen.getByTestId("owner-home-money");
    // No metric switch inside Money: the collections/attendance choice
    // is not a financial decision.
    expect(money.querySelector('nav[aria-label="Metric"]')).toBeNull();
    expect(within(money).queryByRole("link", { name: "Attendance" })).toBeNull();
    // Money carries financial summaries only.
    expect(money.textContent).not.toContain("present or late");
  });

  it("shows attendance once, outside the Money section, with a drill-down", () => {
    renderHome();
    const attendance = screen.getByTestId("owner-home-attendance");
    // It is a sibling of the Money section, not a child of it.
    expect(attendance.closest('[data-testid="owner-home-money"]')).toBeNull();
    expect(within(attendance).getByRole("heading", { name: "Attendance" })).toBeTruthy();
    // A concise operational summary: marks present or late over marks.
    expect(attendance.textContent).toContain("8 of 10 marks present or late");
    // …and the drill-down to the attendance report.
    const link = within(attendance).getByRole("link", { name: /attendance report/i });
    expect(link.getAttribute("href")).toContain("/owner/reports?");
  });

  it("does not show attendance a second time in the insights section", () => {
    renderHome();
    const insights = screen.queryByTestId("owner-insights-home");
    if (insights) {
      expect(insights.textContent).not.toContain("Attendance by batch");
    }
    // One attendance summary on the page, not a chart and a preview.
    expect(screen.getAllByTestId("owner-home-attendance")).toHaveLength(1);
  });
});

describe("legacy range and chart component contracts", () => {
  it("offers Day, Last 7 days and Month, and defaults to Last 7 days", () => {
    renderHome();
    const range = screen.getByTestId("owner-home-range");
    const names = within(range)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    // Three distinct choices. The Monday-to-now "week" window stays
    // reachable by URL for compatibility, but it is not offered as a
    // second seven-ish button beside "Last 7 days".
    expect(names).toEqual(["Day", "Last 7 days", "Month"]);
    const active = within(range).getByRole("link", { name: "Last 7 days" });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("does not repeat the range beside every panel", () => {
    renderHome();
    const money = screen.getByTestId("owner-home-money");
    const label = "25 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am";
    // The exact range is stated once, in the disclosure.
    expect(money.textContent?.split(label).length ?? 0).toBeLessThanOrEqual(2);
    expect(money.textContent).not.toContain("Last 7 days ·");
  });

  it("puts the exact ranges and the method in an accessible disclosure", () => {
    renderHome();
    const details = screen.getByTestId("owner-home-range-detail");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.textContent).toContain("25 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am");
    expect(details.textContent).toContain("18 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am");
    expect(details.textContent).toContain("IST");
    expect(details.textContent).not.toMatch(/Asia\/(Kolkata|Calcutta)/);
  });

  it("does not offer a second route to the month's history", () => {
    renderHome();
    expect(screen.queryByRole("link", { name: /this month's history/i })).toBeNull();
  });

  it("states the comparison once, not once per panel", () => {
    renderHome();
    const phrase = "No previous collections in the comparison range";
    // The collections panel owns the comparison…
    expect(screen.getByTestId("owner-home-money-trends").textContent).toContain(phrase);
    // …and the payment mix does not repeat it.
    expect(screen.getByTestId("owner-payment-mix").textContent).not.toContain(phrase);
  });

  it("keeps the payment-mix methodology in a disclosure, not as loose prose", () => {
    renderHome();
    const mix = screen.getByTestId("owner-payment-mix");
    const details = within(mix).getByTestId("owner-payment-mix-detail");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.textContent).toContain("Digital");
    expect(details.textContent).toContain("UPI");
  });
});

describe("legacy report component drill-down scope", () => {
  it("carries the selected range and the facility into the attendance report", () => {
    renderHome({ facility: "33333333-3333-4333-8333-333333333333" });
    const attendance = screen.getByTestId("owner-home-attendance");
    const href =
      within(attendance).getByRole("link", { name: /attendance report/i }).getAttribute("href") ?? "";
    expect(href).toContain("from=2026-10-25");
    expect(href).toContain("to=2026-11-01");
    expect(href).toContain("facility=33333333-3333-4333-8333-333333333333");
  });

  it("carries the same range into the transactions drill-down", () => {
    renderHome();
    const money = screen.getByTestId("owner-home-money");
    const href =
      within(money).getByRole("link", { name: /transactions for this period/i }).getAttribute("href") ?? "";
    expect(href).toContain("from=2026-10-25");
    expect(href).toContain("to=2026-11-01");
  });
});
