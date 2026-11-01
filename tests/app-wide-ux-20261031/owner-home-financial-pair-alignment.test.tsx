// @vitest-environment jsdom
//
// Owner Home — the two related financial cards are ONE frame
// (tranche 3, 31 Oct 2026).
//
// What the coordinator's Chrome sweep found on /owner at 1280 px: the
// Collections card and the Payment mix card are a related pair — they
// read the SAME selected range and the SAME scope — but their frames
// end about 40 px apart, so the page looks misaligned.
//
// The contract this file pins (LAYOUT INTENT):
//
//   1. The pair is laid out by ONE grid row, so the frames end
//      together by the grid's own stretch. The band must not opt its
//      items out of the shared row height (no `items-start`).
//   2. NO hard-coded height anywhere in the pair — the alignment comes
//      from the intrinsic layout, not from a pixel height.
//   3. The UNRELATED panels (Attendance, Insights) are not dragged
//      into the same height contract and carry no fixed height either.
//   4. The disclosure inside the payment mix stays a native
//      disclosure, so expanding it is still allowed.
//   5. The phone composition stays a single column.
//
// This file CANNOT certify geometry. It asserts the intended
// composition only; the coordinator measures the real heights in
// production Chrome.

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

vi.mock("@/components/charts/owner-chart-island", () => ({
  OwnerChartIsland: () => null,
}));

import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { OwnerHomeAttendance } from "@/components/owner-home/owner-home-attendance";
import type { BrandingData } from "@/lib/services/branding";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

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

const FIXED_HEIGHT = /(?:^|\s)(?:min-|max-)?h-\[\d+(?:px|rem|vh|%)/;

function dashboard(): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-10-31",
    todayMarked: 0,
    todayTotal: 0,
    activeMemberCount: 16,
    attendanceThisWeekPct: null,
    activeBatchCount: 6,
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
  } as OwnerDashboardData;
}

function charts(overrides: Partial<OwnerChartsData> = {}): OwnerChartsData {
  const buckets = [
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
        { key: "2026-10-31", label: "Sat 31", fullLabel: "31 Oct 2026", present: 8, total: 10, pct: 80 },
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

/** A read that SUCCEEDED and found nothing: a successful zero. */
function zeroCharts(): OwnerChartsData {
  return charts({
    collections: {
      buckets: [],
      groups: [],
      methods: [],
      totalPaise: 0,
      paymentCount: 0,
      previousTotalPaise: 0,
      previousPaymentCount: 0,
      previousIsZero: true,
      reversedPaise: 0,
      reversalCount: 0,
      comparison: "No previous collections in the comparison range",
    },
  } as Partial<OwnerChartsData>);
}

function renderHome(props: { chartsData?: OwnerChartsData | null } = {}) {
  return render(
    <><OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={ALL_CAN}
      chartsData={props.chartsData === undefined ? charts() : props.chartsData}
    /><OwnerHomeCharts data={props.chartsData === undefined ? charts() : props.chartsData} facility={null} canReadFees /><OwnerHomeAttendance data={props.chartsData === undefined ? charts() : props.chartsData} facility={null} /></>,
  );
}

/** The grid that lays the related financial pair out. */
function moneyBand(): HTMLElement {
  return screen.getByTestId("owner-home-money-band");
}

afterEach(cleanup);

describe("owner Home — the related financial pair is one frame (LAYOUT INTENT)", () => {
  it("lays the pair out in one grid row, without opting out of the shared height", () => {
    renderHome();
    const band = moneyBand();
    const collections = screen.getByTestId("owner-home-money-trends");
    const mix = screen.getByTestId("owner-payment-mix");

    // The pair are siblings inside the one band.
    expect(band.contains(collections)).toBe(true);
    expect(band.contains(mix)).toBe(true);
    expect(collections.parentElement).toBe(mix.parentElement);

    // The band is a desktop grid…
    const bandClasses = band.getAttribute("class") ?? "";
    expect(bandClasses).toMatch(/lg:grid-cols-/);

    // …and it does not opt its items out of the shared row height. The
    // two frames end together because the row does, not because a
    // pixel height was written down.
    const grids = [
      band,
      ...Array.from(band.children).filter((child) =>
        (child.getAttribute("class") ?? "").includes("grid"),
      ),
    ];
    for (const grid of grids) {
      expect(grid.getAttribute("class") ?? "").not.toContain("items-start");
    }
  });

  it("carries no hard-coded height in the pair", () => {
    renderHome();
    for (const id of ["owner-home-money-trends", "owner-payment-mix"]) {
      const card = screen.getByTestId(id);
      const classes = card.getAttribute("class") ?? "";
      expect(classes).not.toMatch(FIXED_HEIGHT);
    }
  });

  it("does not drag the unrelated panels into the same height contract", () => {
    renderHome();
    const band = moneyBand();
    const attendance = screen.getByTestId("owner-home-attendance");
    // Attendance is its own operational panel — not a third card in the
    // financial pair.
    expect(band.contains(attendance)).toBe(false);
    expect(attendance.getAttribute("class") ?? "").not.toMatch(FIXED_HEIGHT);
  });

  it("keeps the payment-mix disclosure a native disclosure", () => {
    renderHome();
    const mix = screen.getByTestId("owner-payment-mix");
    const details = within(mix).getByTestId("owner-payment-mix-detail");
    expect(details.tagName.toLowerCase()).toBe("details");
    expect(details.hasAttribute("open")).toBe(false);
  });

  it("keeps the phone composition a single column", () => {
    renderHome();
    const bandClasses = (moneyBand().getAttribute("class") ?? "").split(/\s+/);
    // Any column count is a desktop-only one: the phone stacks.
    const baseColumns = bandClasses.filter(
      (token) => token.includes("grid-cols-") && !token.includes(":"),
    );
    expect(baseColumns).toHaveLength(0);
  });
});

describe("owner Home — the financial pair has ONE empty state", () => {
  it("prints one financial empty state, not two repeated empty cards", () => {
    // A read that succeeded and found nothing.
    renderHome({ chartsData: zeroCharts() });
    const band = screen.getByTestId("owner-home-money");
    const empties =
      band.textContent?.match(/no payments recorded|no collections in this period/gi) ?? [];
    expect(empties).toHaveLength(1);
  });

  it("keeps the authorized transactions access in the empty state", () => {
    renderHome({ chartsData: zeroCharts() });
    const band = screen.getByTestId("owner-home-money");
    const link = within(band).getByRole("link", {
      name: /transactions for this period/i,
    });
    expect(link.getAttribute("href") ?? "").toContain("/owner/fees?tab=transactions");
  });

  it("tells a successful zero read from a failed read", () => {
    // A successful zero read says the figures are zero…
    const { unmount } = renderHome({ chartsData: zeroCharts() });
    let band = screen.getByTestId("owner-home-money");
    expect(band.textContent ?? "").not.toMatch(/unavailable/i);
    unmount();

    // …and a failed read says the figures could not be read, never
    // that nothing was collected.
    renderHome({ chartsData: null });
    band = screen.getByTestId("owner-home-money");
    expect(band.textContent ?? "").toMatch(/unavailable/i);
    expect(band.textContent ?? "").not.toMatch(
      /no payments recorded|no collections in this period/i,
    );
  });

  it("keeps the zero figures themselves visible", () => {
    renderHome({ chartsData: zeroCharts() });
    const band = screen.getByTestId("owner-home-money");
    // The real zero is still on screen — the empty state does not
    // replace the figure with a blank card.
    expect(band.textContent ?? "").toMatch(
      /0 recorded payments|no payments recorded|₹0/,
    );
  });
});
