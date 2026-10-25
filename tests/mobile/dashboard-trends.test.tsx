// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// W1-6 continuation — the owner landing trends, the retiring
// onboarding tile, and the KPI drill-through links. jsdom has no
// layout engine and no matchMedia, so this pins the contract that
// matters: server SVG is the mobile chart, the ECharts island stays
// unmounted without a desktop viewport, and every trend links to its
// filtered report.

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
vi.mock("@/lib/actions/tenant-auth", () => ({ logoutTenantAction: vi.fn() }));

import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { BrandingData } from "@/lib/services/branding";
import type { CollectionsSeries, TrendPoint } from "@/lib/services/owner-analytics";

const DASHBOARD: OwnerDashboardData = {
  tenantName: "Aqua",
  today: "2026-10-08",
  todayMarked: 0,
  todayTotal: 0,
  activeMemberCount: 32,
  attendanceThisWeekPct: null,
  activeBatchCount: 4,
  money: {
    collectedTodayPaise: 0,
    collectedTodayCount: 0,
    outstandingPaise: 0,
    dueInvoiceCount: 0,
    overduePaise: 0,
    overdueInvoiceCount: 0,
  },
  needsAttention: [],
  todaysLanes: [],
  nextClass: null,
  facilityBreakdown: [],
};

const BRANDING = {
  displayName: "Aqua",
  shortName: "AQ",
  accent: "mango",
  fallbackDisplayName: "Aqua",
  fallbackShortName: "AQ",
  initials: "AQ",
} as BrandingData;

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

const ATTENDANCE: TrendPoint[] = [
  { date: "2026-10-01", present: 8, total: 10, pct: 80 },
  { date: "2026-10-02", present: 9, total: 10, pct: 90 },
];

const COLLECTIONS: CollectionsSeries = {
  totalPaise: 250000,
  byDay: [
    { date: "2026-10-01", paise: 150000 },
    { date: "2026-10-02", paise: 100000 },
  ],
  expensesPaise: null,
};

afterEach(cleanup);

describe("owner dashboard trends (W1-6 continuation)", () => {
  it("renders both trend cards with server SVG on the mobile path", () => {
    const { container } = render(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        charts={{ attendance: ATTENDANCE, collections: COLLECTIONS }}
      />,
    );

    expect(screen.getByText("Attendance")).toBeTruthy();
    expect(screen.getByText("Collections")).toBeTruthy();
    // Two server SVG charts inside the trends block (attendance line +
    // collections bars). Scoped to the block because the branding mark
    // is also an svg[role='img'].
    const trends = container.querySelector('[data-testid="dashboard-trends"]')!;
    expect(trends.querySelectorAll("svg[role='img']").length).toBe(2);
    // No matchMedia in jsdom → the lazy ECharts island never mounts and
    // its chunk is never requested on the mobile path.
    expect(container.querySelector('[data-testid="echarts-trend"]')).toBeNull();
  });

  it("links each trend to its filtered report and each KPI to its list", () => {
    render(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        charts={{ attendance: ATTENDANCE, collections: COLLECTIONS }}
      />,
    );

    expect(
      screen.getByRole("link", { name: /full attendance report/i }).getAttribute("href"),
    ).toBe("/owner/reports?from=2026-10-01&to=2026-10-03");
    expect(
      screen.getByRole("link", { name: /daily collections report/i }).getAttribute("href"),
    ).toBe("/owner/reports/collections");
    expect(screen.getByRole("link", { name: /Active members/i }).getAttribute("href")).toBe(
      "/owner/members",
    );
    expect(screen.getByRole("link", { name: /running/i }).getAttribute("href")).toBe(
      "/owner/programs",
    );
  });

  it("shows an honest empty state and no chart when a series is empty", () => {
    const { container } = render(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        charts={{
          attendance: [],
          collections: { totalPaise: 0, byDay: [], expensesPaise: null },
        }}
      />,
    );
    expect(screen.getByText(/no sessions in the last 30 days/i)).toBeTruthy();
    expect(screen.getByText(/no payments recorded in the last 30 days/i)).toBeTruthy();
    const trends = container.querySelector('[data-testid="dashboard-trends"]')!;
    expect(trends.querySelectorAll("svg[role='img']").length).toBe(0);
  });

  it("retires the onboarding tile when setup is complete, keeps it otherwise", () => {
    const { rerender } = render(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        showOnboarding={false}
      />,
    );
    expect(screen.queryByRole("link", { name: "Onboarding" })).toBeNull();

    rerender(
      <OwnerDashboard
        data={DASHBOARD}
        branding={BRANDING}
        terminology={TERMINOLOGY}
        showOnboarding
      />,
    );
    expect(screen.getByRole("link", { name: "Onboarding" }).getAttribute("href")).toBe(
      "/owner/onboarding",
    );
  });

  it("renders no trends section when both analytics reads failed", () => {
    render(<OwnerDashboard data={DASHBOARD} branding={BRANDING} terminology={TERMINOLOGY} />);
    expect(screen.queryByText("Collections")).toBeNull();
    expect(screen.queryByText("Attendance")).toBeNull();
  });
});
