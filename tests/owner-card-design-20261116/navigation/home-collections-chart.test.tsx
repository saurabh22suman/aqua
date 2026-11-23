// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OwnerDashboard } from "@/components/owner-dashboard";
import type { OwnerDashboardData } from "@/lib/services/dashboard";
import type { OwnerChartsData } from "@/lib/services/owner-home-charts";
import type { BrandingData } from "@/lib/services/branding";

const dashboard: OwnerDashboardData = {
  tenantName: "Business", scopeLocationName: null, today: "2026-11-16", todayMarked: 0, todayTotal: 0,
  activeMemberCount: 0, attendanceThisWeekPct: null, activeBatchCount: 0, money: null,
  needsAttention: [], todaysLanes: [], nextClass: null, facilityBreakdown: [],
};
const branding = { displayName: "Business", fallbackDisplayName: "Business" } as BrandingData;
const charts: OwnerChartsData = {
  timezone: "Asia/Kolkata",
  period: { key: "last7", tabLabel: "Last 7 days", comparisonLabel: "", comparisonMeaning: "", currentLabel: "", previousLabel: "", currentFromDate: "2026-11-10", currentToDate: "2026-11-16", previousFromDate: "2026-11-03", previousToDate: "2026-11-09", previousCapped: false, capNote: null },
  collections: { buckets: [
    { key: "2026-11-10", label: "10", fullLabel: "10 Nov", cash: 10050, digital: 0, other: 0, totalPaise: 10050 },
    { key: "2026-11-11", label: "11", fullLabel: "11 Nov", cash: 0, digital: 20500, other: 0, totalPaise: 20500 },
  ], groups: [], methods: [], totalPaise: 30550, paymentCount: 2, previousTotalPaise: 0, previousPaymentCount: 0, previousIsZero: true, reversedPaise: 0, reversalCount: 0, comparison: "" },
  attendance: { buckets: [], present: 0, total: 0, pct: null, previousPresent: 0, previousTotal: 0, previousPct: null, comparison: "" },
};
const can = { addMember: false, recordPayment: false, captureEnquiry: false, readFees: true, viewSchedule: false, viewTrend: true };
const renderHome = (data: OwnerChartsData | null, grants = can) => render(<OwnerDashboard data={dashboard} branding={branding} terminology={{ locale: "en", overrides: {} }} chartsData={data} can={grants} facility="site-a" />);
afterEach(cleanup);

it("shows actual bucket amounts, total, range and scoped report link", () => {
  renderHome(charts);
  const card = screen.getByRole("region", { name: "Collections trend" });
  expect(within(card).getByText(/Last 7 days/)).toBeTruthy();
  expect(within(card).getByText(/10 Nov 2026.*16 Nov 2026/)).toBeTruthy();
  expect(within(card).getByText("₹305.50")).toBeTruthy();
  expect(within(card).getByText("₹100.50")).toBeTruthy();
  expect(within(card).getAllByText("₹205.00").length).toBeGreaterThan(0);
  expect(within(card).getByRole("button", { name: "10 Nov, ₹100.50" })).toBeTruthy();
  expect(within(card).getByRole("button", { name: "11 Nov, ₹205.00" })).toBeTruthy();
  expect(within(card).getByRole("link", { name: /view trend/i }).getAttribute("href")).toBe("/owner/reports/collections?view=trends&period=last7&facility=site-a");
});
it("distinguishes an empty collection period from missing data", () => {
  renderHome({ ...charts, collections: { ...charts.collections, buckets: [], totalPaise: 0, paymentCount: 0 } });
  expect(screen.getByText("No payments recorded in this period.")).toBeTruthy();
  expect(screen.queryByRole("img", { name: /collections trend/i })).toBeNull();
  cleanup();
  renderHome(null);
  expect(screen.getByText("Collections trend unavailable.")).toBeTruthy();
  expect(screen.queryByRole("img", { name: /collections trend/i })).toBeNull();
});
it("does not expose the card without financial access", () => {
  renderHome(charts, { ...can, readFees: false, viewTrend: false });
  expect(screen.queryByRole("region", { name: "Collections trend" })).toBeNull();
});
it("uses the supplied period for the title and link, and withholds unauthorized links", () => {
  const month = { ...charts, period: { ...charts.period, key: "month" as const, tabLabel: "Month" } };
  renderHome(month);
  const card = screen.getByRole("region", { name: "Collections trend" });
  expect(within(card).getByText(/^Month/)).toBeTruthy();
  expect(within(card).getByRole("link", { name: /view trend/i }).getAttribute("href")).toContain("period=month&facility=site-a");
  cleanup();
  renderHome(month, { ...can, viewTrend: false });
  expect(within(screen.getByRole("region", { name: "Collections trend" })).queryByRole("link", { name: /view trend/i })).toBeNull();
});
it("does not draw a synthetic line for all-zero buckets", () => {
  renderHome({ ...charts, collections: { ...charts.collections, buckets: charts.collections.buckets.map((bucket) => ({ ...bucket, totalPaise: 0 })), totalPaise: 0, paymentCount: 0 } });
  expect(screen.getByText("No payments recorded in this period.")).toBeTruthy();
  expect(screen.queryByRole("img", { name: /collections trend/i })).toBeNull();
});
