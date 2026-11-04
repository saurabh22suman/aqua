// @vitest-environment jsdom
//
// Shared truthful wording (31 October 2026).
//
// Four claims the product made that were not true:
//
//   1. "captured payments" in the Owner Home money band — the house
//      term everywhere else (Fees, Reports, Reception) is "recorded
//      payments", and the word that reaches the owner should be the
//      same one.
//   2. "Revenue by plan" — the entity is a MEMBERSHIP PLAN and the
//      measure is recorded collections, not revenue: Aqua does not
//      track expenses, so "revenue" claims more than the data says.
//   3. The parent-link description listed less than the page shows. The
//      signed /p/[token] page also carries the membership plan and the
//      outstanding fees, and anyone with the URL can open it until it
//      expires.
//   4. "Every tenant is healthy right now. The queue reads live tenant
//      health, so it never goes stale." — an empty queue only means no
//      tenant matched the queue's specific checks. It does not establish
//      that every tenant is healthy, and the queue is not a claim that
//      nothing is ever stale.
//
// These are rendered assertions on the visible copy, not source greps.

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

vi.mock("@/lib/actions/parent-link", () => ({
  issueParentLinkAction: async () => ({
    kind: "error",
    message: "not needed for this assertion",
  }),
}));

// The Ops console page resolves its reads through the approved
// operation boundary; the page contract is what this file asserts, so
// the boundary delegates to the read it is given. Fixture-only.
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsRead: async (
    _operation: string,
    _tenantId: string,
    read: () => Promise<unknown>,
  ) => read(),
  runOpsGlobalRead: async (
    _operation: string,
    read: () => Promise<unknown>,
  ) => read(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));
const queueMock = vi.fn();
vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    activeTenants: { current: 0, previous: null },
    trialTenants: { current: 0, previous: null },
    atRiskTenants: { current: 0, previous: null },
    openOpsTasks: { current: 0, previous: null },
    asOf: null,
  }),
  getNeedsAttentionQueue: () => queueMock(),
}));
vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [], total: 0 }),
}));

import { OwnerHomeCharts } from "@/components/owner-home-charts";
import { PlanRevenueCard } from "@/components/reports/analytics-cards";
import { ParentLinkExplainer } from "@/components/parent-link-explainer";
import { ParentLinkPanel } from "@/components/parent-link-panel";
import PlatformHome from "@/app/(platform)/ops/page";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";

const CHART_FIXTURE = {
  timezone: "Asia/Kolkata",
  period: {
    key: "last7",
    tabLabel: "Last 7 days",
    comparisonLabel: "7-day",
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
    groups: [{ key: "cash", label: "Cash", paise: 100000, count: 2, pct: 100 }],
    methods: [{ key: "cash", label: "Cash", group: "cash", paise: 100000, count: 2, pct: 100 }],
    totalPaise: 100000,
    paymentCount: 2,
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
} as unknown as OwnerChartsData;

afterEach(cleanup);

describe("truthful wording — the money band", () => {
  it("says recorded payments, not captured payments", () => {
    render(
      <OwnerHomeCharts data={CHART_FIXTURE} facility={null} canReadFees />,
    );
    const band = screen.getByTestId("owner-home-money");
    expect(band.textContent).toContain("recorded payment");
    expect(band.textContent).not.toContain("captured payment");
  });

  it("says no payments were RECORDED when the period is empty", () => {
    const empty = {
      ...CHART_FIXTURE,
      collections: {
        ...CHART_FIXTURE.collections,
        totalPaise: 0,
        paymentCount: 0,
        groups: [],
        methods: [],
      },
    } as unknown as OwnerChartsData;
    render(<OwnerHomeCharts data={empty} facility={null} canReadFees />);
    const band = screen.getByTestId("owner-home-money");
    expect(band.textContent).toContain("No payments recorded in this period");
    expect(band.textContent).not.toContain("No payments captured in this period");
  });
});

describe("truthful wording — the membership plan card", () => {
  it("names the entity (membership plan) and the measure (collections)", () => {
    render(
      <PlanRevenueCard
        rows={[{ planName: "Gold monthly", paise: 250000, paymentCount: 4 }]}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Collections by membership plan");
    expect(text).not.toContain("Revenue by plan");
  });

  it("says the empty state in terms of the membership plan", () => {
    render(<PlanRevenueCard rows={[]} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/membership plan/i);
    expect(text).not.toMatch(/no plan-linked collections/i);
  });
});

describe("truthful wording — the parent link", () => {
  it("uses the club's term for the next scheduled activity", () => {
    render(
      <ParentLinkPanel memberId="m1" memberName="Asha Rao" primaryGuardianName={null}
        terminology={{ locale: "en", overrides: { session: { en: { one: "lesson", other: "lessons" } } } }} />,
    );
    expect(screen.getByTestId("parent-link-panel").textContent).toMatch(/next lesson/i);
  });

  it("describes what the signed page actually shows", () => {
    render(
      <ParentLinkPanel
        memberId="m1"
        memberName="Asha Rao"
        primaryGuardianName="Meera Rao"
      />,
    );
    const panel = screen.getByTestId("parent-link-panel");
    const text = panel.textContent ?? "";
    // The page shows the next session, this month's attendance, the
    // membership plan AND the outstanding fees.
    expect(text).toMatch(/next session/i);
    expect(text).toMatch(/attendance/i);
    expect(text).toMatch(/membership plan/i);
    expect(text).toMatch(/fees|invoices/i);
  });

  it("tells the owner that anyone with the URL can open the page", () => {
    render(
      <ParentLinkPanel
        memberId="m1"
        memberName="Asha Rao"
        primaryGuardianName="Meera Rao"
      />,
    );
    const panel = screen.getByTestId("parent-link-panel");
    expect(panel.textContent).toMatch(/anyone with the (url|link)/i);
  });

  it("tells the parent what the link opens", () => {
    render(<ParentLinkExplainer />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/membership plan/i);
    expect(text).toMatch(/fees|invoices/i);
  });
});

describe("truthful wording — the Ops attention queue", () => {
  it("does not claim an empty queue means every tenant is healthy", async () => {
    queueMock.mockResolvedValue([]);
    render(await PlatformHome());

    const text = document.body.textContent ?? "";
    expect(text).toContain("Nothing needs attention");
    // The old claim was: an empty queue means every tenant is healthy
    // and the queue never goes stale. Neither is true.
    expect(text).not.toMatch(/every tenant is healthy right now/i);
    expect(text).not.toMatch(/never goes stale/i);
    // It says what the queue actually checks, and what an empty queue
    // does NOT establish.
    expect(text).toMatch(/matches these checks/i);
    expect(text).toMatch(/not a statement that every tenant is healthy/i);
  });
});
