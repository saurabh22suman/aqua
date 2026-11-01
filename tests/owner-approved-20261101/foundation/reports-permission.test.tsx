import { beforeEach, expect, it, vi } from "vitest";

const { money, operational, charts, permissions, features } = vi.hoisted(() => ({
  money: vi.fn(), operational: vi.fn(), charts: vi.fn(), permissions: new Set<string>(), features: new Set<string>(),
}));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({ tenantId: "tenant", userId: "user", permissions, features }),
  requirePagePermission: () => undefined,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => [] }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/owner-reports", () => ({
  getAttendanceReportAction: async () => [], getEnquiryFunnelAction: async () => [],
  getRetentionViewAction: async () => null, getCoachLoadAction: async () => [],
  getFacilityUtilisationAction: async () => null, attendanceReportCsvAction: vi.fn(),
}));
vi.mock("@/lib/actions/owner-analytics", () => ({
  getMoneyAnalyticsAction: money,
}));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsAttendanceAction: operational }));
vi.mock("@/lib/services/owner-people-reports", () => ({ getMembersReport: async () => ({ statuses: [], joined: 0 }), getStaffReport: async () => ({ attendance: [], shifts: [] }) }));
vi.mock("@/lib/services/owner-batch-report", () => ({ getOwnerBatchReport: async () => [] }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: charts }));

import ReportsPage from "@/app/(owner)/owner/reports/page";

beforeEach(() => {
  permissions.clear(); permissions.add("reports.operational");
  features.clear(); features.add("reports"); features.add("billing");
  money.mockReset().mockResolvedValue({ collections: {}, planRevenue: [] });
  operational.mockReset().mockResolvedValue({ attendanceTrend: [], memberMix: [] });
  charts.mockReset().mockResolvedValue({ collections: { paymentCount: 0 } });
});

it("does not query money if the billing feature is disabled", async () => {
  permissions.add("reports.financial"); permissions.add("invoices.read");
  features.delete("billing");
  await ReportsPage({});
  expect(money).not.toHaveBeenCalled();
});

it("passes the explicit half-open range and facility to scoped analytics", async () => {
  const facility = "11111111-1111-4111-8111-111111111111";
  permissions.add("reports.financial"); permissions.add("invoices.read");
  await ReportsPage({ searchParams: Promise.resolve({ from: "2026-10-01", to: "2026-10-08", facility }) });
  expect(operational).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-08", locationId: facility });
  expect(money).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-08" }, facility);
});

it("does not start financial analytics for an operational-only viewer", async () => {
  await ReportsPage({});
  expect(operational).toHaveBeenCalledOnce();
  expect(money).not.toHaveBeenCalled();
  expect(charts).not.toHaveBeenCalled();
});

it("requires invoice access as well as the financial report grant", async () => {
  permissions.add("reports.financial");
  await ReportsPage({});
  expect(money).not.toHaveBeenCalled();
});

it("starts financial analytics when both grants are present", async () => {
  permissions.add("reports.financial"); permissions.add("invoices.read");
  await ReportsPage({});
  expect(money).toHaveBeenCalledOnce();
});

it("defaults to today and the preceding six dates, with an exclusive end", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  try {
    await ReportsPage({});
    expect(operational).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02" });
  } finally {
    vi.useRealTimers();
  }
});
