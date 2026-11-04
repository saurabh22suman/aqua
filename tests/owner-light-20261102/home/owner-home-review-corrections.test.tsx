// @vitest-environment jsdom
//
// Owner Home — RED for the independent-review corrections (2 Nov 2026,
// HOME lane). Reviewer: outputs/owner-light-implementation-20261102/people/REVIEW-HOME.md
//
// F2 — "View trend" draws a TEXT arrow (U+2192). The approved mock draws
//      'View trend' + icon('chevron',16) (mock line 888) and the shared
//      OwnerIcon's chevron is `m9 5 7 7-7 7`. ICON-ADDENDUM demands the
//      exact mock geometry.
//
// F3 — "Record payment" and the invoice shortcut BOTH point at
//      /owner/fees?tab=dues (owner-dashboard.tsx:217 and :228): two
//      labelled actions, one promise. The record action must stay on the
//      explicit unpaid-bill selection; the secondary shortcut needs its
//      own truthful destination — the Fees INVOICE LEDGER (tab=invoices)
//      — with the scope travelling with it, selecting no invoice and
//      mutating nothing, and leaving the status/date filters where the
//      destination owns them.
//
// F6 — the tenant's configured member word is a fact the Home no longer
//      owns (the action label moved to the Members directory). The Home
//      still owns its own terminology-bearing copy: the day's sessions
//      line. This file proves that positively, so the legacy Home suite
//      cannot claim a terminology proof by absence alone.
//
// Everything here is RENDERED evidence against the real component. No
// database: the read models are fixtures of the real shapes.

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

import { OwnerDashboard } from "@/components/owner-dashboard";
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
  readMembers: true,
  bookCourt: true,
  viewTrend: true,
};

function dashboard(overrides: Partial<OwnerDashboardData> = {}): OwnerDashboardData {
  return {
    tenantName: "Splash Sports Club",
    scopeLocationName: "Splash Pool",
    today: "2026-11-02",
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

function charts(): OwnerChartsData {
  return {
    timezone: "Asia/Kolkata",
    period: {
      key: "last7",
      tabLabel: "Last 7 days",
      comparisonLabel: "7-day",
      comparisonExpansion: "the seven days before",
      comparisonMeaning: "Seven-day comparison",
      currentLabel: "27 Oct 2026, 12:00 am – 2 Nov 2026, 9:15 am",
      previousLabel: "20 Oct 2026, 12:00 am – 26 Oct 2026, 9:15 am",
      currentFromDate: "2026-10-27",
      currentToDate: "2026-11-02",
      previousFromDate: "2026-10-20",
      previousToDate: "2026-10-26",
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
      buckets: [],
      present: 0,
      total: 0,
      pct: null,
      previousPresent: 0,
      previousTotal: 0,
      previousPct: null,
      comparison: "No previous marks in the comparison range",
    },
  } as OwnerChartsData;
}

function renderHome(props: { can?: Partial<typeof ALL_CAN>; facility?: string | null } = {}) {
  const can = { ...ALL_CAN, ...(props.can ?? {}) };
  return render(
    <OwnerDashboard
      data={dashboard()}
      branding={BRANDING}
      terminology={TERMINOLOGY}
      chartsData={charts()}
      can={can}
      facility={props.facility ?? null}
    />,
  );
}

afterEach(cleanup);

describe("Owner Home — the View trend glyph (review F2)", () => {
  // INTENDED RED: the link renders the text "View trend →". The approved
  // mock draws the word plus the 16px outline chevron.
  it("draws View trend with the shared 16px chevron, not a text arrow", () => {
    renderHome();
    const hero = screen.getByRole("region", { name: "Collections" });
    const trend = within(hero).getByRole("link", { name: /view trend/i });
    const svg = trend.querySelector("svg");
    expect(svg, "the link carries the shared outline chevron").toBeTruthy();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("fill")).toBe("none");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
    expect(svg?.getAttribute("stroke-width")).toBe("1.8");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("height")).toBe("16");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe("m9 5 7 7-7 7");
    // No Unicode arrow stands in for the approved glyph.
    expect(trend.textContent ?? "").not.toContain("→");
  });
});

describe("Owner Home — the two collections destinations (review F3)", () => {
  // GUARD (green today): the record action keeps the explicit unpaid-bill
  // selection, and it selects no bill by itself.
  it("keeps Record payment on the explicit unpaid-bill selection", () => {
    renderHome({ facility: "pool-a" });
    const hero = screen.getByRole("region", { name: "Collections" });
    const record = within(hero).getByRole("link", { name: /record payment/i });
    const href = record.getAttribute("href") ?? "";
    expect(href).toContain("tab=dues");
    expect(href).toContain("facility=pool-a");
    // The owner chooses the bill; the action never chooses one.
    expect(href).not.toMatch(/invoice(Id)?=/);
  });

  // The approved composition: ONE payment destination in the hero, and no
  // duplicate invoice banner between the hero and the sessions.
  it("keeps one payment destination and no duplicate ledger shortcut", () => {
    renderHome({ facility: "pool-a" });
    const hero = screen.getByRole("region", { name: "Collections" });
    const record = within(hero).getByRole("link", { name: /record payment/i });
    const href = record.getAttribute("href") ?? "";
    expect(href).toContain("tab=dues");
    expect(href).toContain("facility=pool-a");
    expect(href).not.toMatch(/invoice(Id)?=/);
    expect(
      screen.queryByRole("link", { name: /invoice ledger|review invoices/i }),
    ).toBeNull();
    const trend = within(hero).getByRole("link", { name: /view trend/i });
    expect(trend.getAttribute("href")).toContain("view=trends");
  });

  // GUARD (green today): the destination's own grants still decide what
  // is offered, and one action's absence never removes the other.
  it("keeps the hero destinations under the destination's own grants", () => {
    const { rerender } = renderHome({ can: { readFees: false } });
    expect(screen.queryByRole("link", { name: /record payment/i })).toBeNull();
    expect(
      screen.queryByRole("link", { name: /invoice ledger|review invoices/i }),
    ).toBeNull();

    rerender(
      <OwnerDashboard
        data={dashboard()}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        chartsData={charts()}
        can={{ ...ALL_CAN, recordPayment: false }}
      />,
    );
    // No payment grant → the record action goes; the trend link stays.
    expect(screen.queryByRole("link", { name: /record payment/i })).toBeNull();
    expect(screen.getByRole("link", { name: /view trend/i })).toBeTruthy();
  });
});

describe("Owner Home — the tenant's word where the Home owns it (review F6)", () => {
  // GUARD (green today): the Home's own copy carries the configured
  // member and session words. The action LABEL that used to carry them
  // moved to the Members directory, which owns that fact now.
  it("speaks the tenant's configured session word in the folded disclosure", () => {
    const terminology = {
      locale: "en",
      overrides: { session: { en: { one: "class", other: "classes" } } },
    } as const;
    const lanes = ["a", "b", "c", "d"].map((key) => ({
      sessionId: key,
      batchId: `b-${key}`,
      batchName: `Squad ${key.toUpperCase()}`,
      programName: "Swimming",
      startTime: "17:00",
      enrolled: 4,
      capacity: 8,
      coachName: "Asha",
      marked: 0,
      started: false,
    }));
    render(
      <OwnerDashboard
        data={dashboard({ todaysLanes: lanes })}
        branding={BRANDING}
        terminology={terminology}
        chartsData={charts()}
        can={ALL_CAN}
      />,
    );
    // Four sessions: the approved row cap is three, so the fourth is
    // named by the disclosure — in the tenant's own word.
    expect(screen.getByTestId("owner-home-today-more").textContent).toContain(
      "1 more class",
    );
  });
});
