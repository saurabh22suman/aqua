// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ attendance: vi.fn(), members: vi.fn(), staff: vi.fn(), batches: vi.fn(), charts: vi.fn(), operational: vi.fn(), money: vi.fn(), enquiry: vi.fn(), retention: vi.fn(), coach: vi.fn(), permissions: new Set<string>(), features: new Set<string>(), cookie: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => s.cookie ? { value: s.cookie } : undefined }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "tenant", userId: "user", permissions: s.permissions, features: s.features, allLocations: true, locationIds: [] }), requirePagePermission: (_ctx: unknown, key: string) => { if (!s.permissions.has(key)) throw new Error("denied"); } }));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsAttendanceAction: s.attendance }));
vi.mock("@/lib/services/owner-people-reports", () => ({ getMembersReport: s.members, getStaffReport: s.staff }));
vi.mock("@/lib/services/owner-batch-report", () => ({ getOwnerBatchReport: s.batches }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: s.charts }));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/owner-reports", () => ({ getAttendanceReportAction: async () => [], getEnquiryFunnelAction: s.enquiry, getRetentionViewAction: s.retention, getCoachLoadAction: s.coach, getFacilityUtilisationAction: async () => null, attendanceReportCsvAction: vi.fn() }));
vi.mock("@/lib/actions/owner-analytics", () => ({ getOperationalAnalyticsAction: s.operational, getMoneyAnalyticsAction: s.money }));
vi.mock("@/components/reports/enquiry-funnel-card", () => ({ EnquiryFunnelCard: () => <p>Enquiry funnel</p> }));
vi.mock("@/components/reports/coach-load-card", () => ({ CoachLoadCard: () => <p>Coach load</p> }));
import ReportsPage from "@/app/(owner)/owner/reports/page";

beforeEach(() => {
  s.permissions.clear(); s.permissions.add("reports.operational"); s.features.clear(); s.features.add("reports"); s.features.add("billing"); s.cookie = "";
  s.attendance.mockReset().mockResolvedValue({ summary: { marks: { present: 6, late: 2, absent: 2, total: 10 }, register: { completedRegisters: 1, sessionsWithRoster: 2, unmarkedSlots: 2 } }, rows: [] });
  s.members.mockReset().mockResolvedValue({ statuses: [{ status: "active", count: 7 }], joined: 2, joinedUnknown: 0, joinedByDay: [] });
  s.staff.mockReset().mockResolvedValue({ attendance: [{ checkedIn: true }], shifts: [] });
  s.batches.mockReset().mockResolvedValue([{ reservedPlaces: 4, capacity: 10 }]);
  s.charts.mockReset().mockResolvedValue({ collections: { paymentCount: 3 } });
  s.operational.mockReset().mockResolvedValue({ attendanceTrend: [], memberMix: [] });
  s.money.mockReset().mockResolvedValue({ collections: {}, planRevenue: [] });
  s.enquiry.mockReset().mockResolvedValue([]); s.retention.mockReset().mockResolvedValue(null); s.coach.mockReset().mockResolvedValue([]);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.localStorage.clear(); });

it("loads real last-seven operational attendance without denied staff or finance reads", async () => {
  await ReportsPage({});
  expect(s.attendance).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02" });
  expect(s.members).toHaveBeenCalledOnce();
  expect(s.staff).not.toHaveBeenCalled();
  expect(s.charts).not.toHaveBeenCalled();
});

it("renders one attendance lead, recovery link and closed More reports disclosure", async () => {
  render(await ReportsPage({}));
  expect(screen.getByText("80%")).toBeTruthy();
  expect(screen.getByRole("link", { name: /customize reports/i })).toBeTruthy();
  expect(screen.getByText("More reports").closest("details")?.open).toBe(false);
});

it("exposes a named and titled icon link for scoped report customization", async () => {
  const facility = "11111111-1111-4111-8111-111111111111";
  render(await ReportsPage({ searchParams: Promise.resolve({ facility }) }));
  const link = screen.getByRole("link", { name: "Customize reports" });
  expect(link.getAttribute("title")).toBe("Customize reports");
  expect(link.querySelector("svg")).not.toBeNull();
  expect(link.getAttribute("href")).toContain(`facility=${facility}`);
});

it("rejects an incomplete legacy range without making report reads", async () => {
  render(await ReportsPage({ searchParams: Promise.resolve({ from: "2026-10-01" }) }));
  expect(screen.getByRole("alert").textContent).toMatch(/invalid/i);
  expect(s.attendance).not.toHaveBeenCalled();
});

it("denies before any data reads without operational permission", async () => {
  s.permissions.clear();
  await expect(ReportsPage({})).rejects.toThrow("denied");
  expect(s.attendance).not.toHaveBeenCalled(); expect(s.members).not.toHaveBeenCalled();
});

it("retains the scoped site and half-open legacy dates without mismatched financial charts", async () => {
  const facility = "11111111-1111-4111-8111-111111111111";
  s.permissions.add("reports.financial"); s.permissions.add("invoices.read"); s.permissions.add("staff.attendance");
  render(await ReportsPage({ searchParams: Promise.resolve({ from: "2026-10-01", to: "2026-10-08", facility }) }));
  expect(s.attendance).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-08", locationId: facility });
  expect(s.members).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", userId: "user" }), { from: "2026-10-01", to: "2026-10-07", locationId: facility });
  expect(s.staff).toHaveBeenCalledOnce(); expect(s.charts).not.toHaveBeenCalled();
  expect(s.enquiry).not.toHaveBeenCalled(); expect(s.retention).not.toHaveBeenCalled(); expect(s.coach).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: /Attendance/ }).getAttribute("href")).toContain("to=2026-10-07");
  expect(screen.getByRole("link", { name: /Customize reports/i }).getAttribute("href")).toContain(`facility=${facility}`);
});

it("keeps Customize reports available when every permitted family is hidden", async () => {
  window.localStorage.setItem("aqua:owner-report-preferences:tenant:user", JSON.stringify({ attendance: false, members: false, staff: false, batches: false, collections: false }));
  render(await ReportsPage({}));
  expect(screen.queryByRole("link", { name: /Attendance/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Customize reports" })).toBeTruthy();
  expect(screen.getByText("No report cards selected")).toBeTruthy();
  expect(screen.getByText("No report cards selected").closest("a")?.getAttribute("href")).toContain("/owner/settings/reports?facility=all");
});

it("shows recovery when only unauthorized families are enabled, but not when an authorized family is enabled", async () => {
  const key = "aqua:owner-report-preferences:tenant:user";
  window.localStorage.setItem(key, JSON.stringify({ attendance: false, members: false, staff: true, batches: false, collections: true }));
  const view = render(await ReportsPage({}));
  expect(screen.getByText("No report cards selected")).toBeTruthy();
  view.unmount();
  window.localStorage.setItem(key, JSON.stringify({ attendance: false, members: true, staff: false, batches: false, collections: false }));
  render(await ReportsPage({}));
  expect(screen.queryByText("No report cards selected")).toBeNull();
});

it("shows unknown marks rather than zero and preserves error state", async () => {
  s.attendance.mockResolvedValueOnce({ summary: { marks: { present: 0, late: 0, absent: 0, total: 0 }, register: { completedRegisters: 0, sessionsWithRoster: 0, unmarkedSlots: 0 } }, rows: [] });
  const view = render(await ReportsPage({}));
  expect(screen.getByText("No marks")).toBeTruthy(); expect(screen.queryByText("0%")).toBeNull();
  view.unmount(); s.attendance.mockRejectedValueOnce(new Error("failed"));
  render(await ReportsPage({})); expect(screen.getByText("Could not load attendance")).toBeTruthy();
});

it("uses actual authorized check-in, capacity and payment counts without inferring money", async () => {
  s.permissions.add("staff.attendance"); s.permissions.add("reports.financial"); s.permissions.add("invoices.read");
  const facility = "11111111-1111-4111-8111-111111111111";
  render(await ReportsPage({ searchParams: Promise.resolve({ period: "week", facility }) }));
  expect(s.charts).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", userId: "user", permissions: s.permissions }), { period: "week", locationId: facility });
  expect(s.batches).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant", userId: "user" }), facility);
  expect(screen.getByText("Recorded check-ins")).toBeTruthy();
  expect(screen.getByText("Reserved of 10 places · current")).toBeTruthy();
  expect(screen.getByText("Captured payments")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Payments recorded/ }).getAttribute("href")).toContain(`view=trends&period=week&facility=${facility}`);
});

it("uses explicit all rather than a remembered facility", async () => {
  s.cookie = "11111111-1111-4111-8111-111111111111";
  render(await ReportsPage({ searchParams: Promise.resolve({ facility: "all" }) }));
  expect(s.attendance).toHaveBeenCalledWith({ from: "2026-10-26", to: "2026-11-02" });
  expect(screen.getByRole("link", { name: /Customize reports/i }).getAttribute("href")).toContain("facility=all");
});

it("rejects impossible dates and conflicting ranges before all reads", async () => {
  for (const params of [{ from: "2026-02-30", to: "2026-03-02" }, { from: "2026-10-01", to: "2026-10-08", period: "week" }]) {
    const view = render(await ReportsPage({ searchParams: Promise.resolve(params) }));
    expect(screen.getByRole("alert").textContent).toMatch(/invalid/i);
    expect(s.attendance).not.toHaveBeenCalled(); expect(s.members).not.toHaveBeenCalled();
    view.unmount();
  }
});
