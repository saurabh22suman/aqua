// @vitest-environment jsdom
//
// Owner Home — the selected range is a compact toolbar (tranche 3,
// 31 Oct 2026).
//
// What the coordinator's Chrome sweep found on /owner: immediately
// before the Money title the page printed a "RANGE" eyebrow, the
// sentence "Collections, payment mix and attendance" and a full-width
// methodology bar ("How this is measured") — and then the Money
// section repeated the same scope in its own subtitle. The exact
// instants and the comparison method belong in an accessible
// disclosure, not as a bar that is always on screen.
//
// The contract this file pins:
//
//   1. No eyebrow and no redundant visible sentence in the range
//      strip. The toolbar carries the control, not prose.
//   2. The exact instants, the comparison and the methodology stay
//      reachable in a native disclosure that is CLOSED by default, so
//      they are never printed beside the control.
//   3. The disclosure is a compact control, not an always-visible
//      filled full-width bar (LAYOUT INTENT).
//   4. Day / Last 7 days / Month, the selected key and the facility
//      scope are unchanged.
//   5. Attendance stays outside Money.

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
import { OwnerHomeRange } from "@/components/owner-home/owner-home-range";
import type { OwnerPeriodKey } from "@/lib/time/owner-periods";
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

const CURRENT_INSTANTS = "25 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am";
const PREVIOUS_INSTANTS = "18 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am";

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
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
    ...overrides,
  } as OwnerDashboardData;
}

function charts(): OwnerChartsData {
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
      currentLabel: CURRENT_INSTANTS,
      previousLabel: PREVIOUS_INSTANTS,
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
  } as OwnerChartsData;
}

function renderHome(props: {
  facility?: string | null;
  period?: OwnerPeriodKey;
  charts?: OwnerChartsData | null;
} = {}) {
  return render(
    <OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      can={ALL_CAN}
      chartsData={props.charts === undefined ? charts() : props.charts}
      facility={props.facility ?? null}
      period={props.period ?? "last7"}
    />,
  );
}

function renderRange(props: { facility?: string | null; period?: OwnerPeriodKey; charts?: OwnerChartsData | null } = {}) {
  return render(<OwnerHomeRange data={props.charts === undefined ? charts() : props.charts} period={props.period ?? "last7"} facility={props.facility ?? null} />);
}

afterEach(cleanup);

describe("owner Home — the range is a compact toolbar", () => {
  it("does not print a redundant visible sentence or eyebrow", () => {
    renderRange();
    const range = screen.getByTestId("owner-home-range");
    // The scope sentence belongs to the Money section, not to the
    // range control.
    expect(range.textContent ?? "").not.toContain(
      "Collections, payment mix and attendance",
    );
    // The eyebrow is gone — no visible element says only "Range".
    const eyebrows = Array.from(range.querySelectorAll("p, span")).filter(
      (node) => (node.textContent ?? "").trim() === "Range",
    );
    expect(eyebrows).toHaveLength(0);
  });

  it("keeps the exact instants and the method in a disclosure that is closed by default", () => {
    renderRange();
    const range = screen.getByTestId("owner-home-range");
    const details = range.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.tagName.toLowerCase()).toBe("details");
    // Closed: the instants are reachable but not printed beside the
    // control.
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.textContent ?? "").toContain(CURRENT_INSTANTS);
    expect(details?.textContent ?? "").toContain(PREVIOUS_INSTANTS);
    expect(details?.textContent ?? "").toContain("IST");
    expect(details?.textContent ?? "").not.toMatch(/Asia\/(Kolkata|Calcutta)/);
    expect(details?.textContent ?? "").toMatch(/comparison/i);

    // Nothing outside the disclosure prints the instants.
    const collapsed = range.cloneNode(true) as HTMLElement;
    collapsed.querySelectorAll("details").forEach((node) => node.remove());
    expect(collapsed.textContent ?? "").not.toContain(CURRENT_INSTANTS);
  });

  it("is a compact control, not an always-visible filled bar (LAYOUT INTENT)", () => {
    // LAYOUT INTENT — this asserts the intended composition, not a
    // rendered measurement. The coordinator's Chrome run establishes
    // the real geometry.
    renderRange();
    const details = screen
      .getByTestId("owner-home-range")
      .querySelector("details");
    const classes = details?.getAttribute("class") ?? "";
    expect(classes).not.toContain("bg-deck");
    expect(classes).not.toContain("w-full");
  });

  it("keeps Day, Last 7 days and Month, with the selected key marked", () => {
    renderRange();
    const range = screen.getByTestId("owner-home-range");
    const names = within(range)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(names).toEqual(["Day", "Last 7 days", "Month"]);
    expect(
      within(range).getByRole("link", { name: "Last 7 days" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps the facility scope in every range link", () => {
    renderRange({ facility: "loc-9" });
    const range = screen.getByTestId("owner-home-range");
    for (const link of within(range).getAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").toContain("facility=loc-9");
    }
  });
});

describe("owner Home — the Monday-to-now week stays truthful", () => {
  const WEEK_INSTANTS = "27 Oct 2026, 12:00 am – 31 Oct 2026, 9:15 am";

  function weekCharts(): OwnerChartsData {
    const base = charts();
    return {
      ...base,
      period: {
        ...base.period,
        key: "week",
        tabLabel: "This week",
        comparisonLabel: "WoW",
        comparisonMeaning:
          "Week over week — this Monday-to-now against last week's same elapsed span",
        currentLabel: WEEK_INSTANTS,
        previousLabel: "20 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am",
        currentFromDate: "2026-10-27",
        currentToDate: "2026-10-31",
        previousFromDate: "2026-10-20",
        previousToDate: "2026-10-24",
      },
    } as OwnerChartsData;
  }

  it("names the week instead of relabelling it", () => {
    renderRange({ period: "week", charts: weekCharts() });
    const range = screen.getByTestId("owner-home-range");

    // The offered choices are unchanged…
    const names = within(range)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(names).toEqual(["Day", "Last 7 days", "Month"]);

    // …and none of them claims to be the week.
    for (const link of within(range).getAllByRole("link")) {
      expect(link.getAttribute("aria-current")).toBeNull();
    }

    // The visible toolbar explains the state: the range it is showing
    // is named, in the range's own words.
    const state = screen.getByTestId("owner-home-range-state");
    expect(state.textContent ?? "").toMatch(/showing this week/i);
    // It is not relabelled as one of the offered windows.
    expect(state.textContent ?? "").not.toMatch(/last 7 days/i);
    expect(state.textContent ?? "").not.toMatch(/month/i);
  });

  it("says only 'Showing this week' — no implementation sentence", () => {
    // The legacy week state is named, and that is all it says. Which
    // control is missing is a fact about the TOOLBAR, not about the
    // range: "a range the three choices above do not offer" is an
    // implementation sentence, printed to the owner.
    renderRange({ period: "week", charts: weekCharts() });
    const state = screen.getByTestId("owner-home-range-state");
    expect((state.textContent ?? "").trim()).toBe("Showing this week");
  });

  it("keeps the week's own exact instants in the disclosure", () => {
    renderRange({ period: "week", charts: weekCharts() });
    const details = screen.getByTestId("owner-home-range-detail");
    expect(details.textContent ?? "").toContain(WEEK_INSTANTS);
    expect(details.textContent ?? "").toContain("20 Oct 2026, 12:00 am – 24 Oct 2026, 9:15 am");
    expect(details.textContent ?? "").toMatch(/week over week/i);
  });
});

describe("owner Home — attendance keeps its own home", () => {
  it("keeps attendance out of the Money band", () => {
    renderHome();
    const money = screen.getByTestId("owner-home-money-surface");
    expect(money.textContent ?? "").not.toContain("present or late");
    // Aggregate attendance belongs to Reports, not the approved Home.
    expect(screen.queryByTestId("owner-home-attendance")).toBeNull();
  });
});
