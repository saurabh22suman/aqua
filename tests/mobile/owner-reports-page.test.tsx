// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Page resilience and authorization with real overview components and scoped DTO fixtures.
const s = vi.hoisted(() => ({
  attendance: vi.fn(), members: vi.fn(), staff: vi.fn(), batches: vi.fn(), charts: vi.fn(),
  enquiry: vi.fn(), retention: vi.fn(), coach: vi.fn(), utilisation: vi.fn(), money: vi.fn(),
  permissions: new Set<string>(), features: new Set<string>(),
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("denied"); } }));
vi.mock("@/lib/auth/surface-guard", async original => ({
  ...await original<typeof import("@/lib/auth/surface-guard")>(),
  requireOwner: async () => ({ tenantId: "tenant", userId: "user", membershipId: "membership", roleId: "role", roleKey: "owner", slug: "club", allLocations: true, locationIds: [], permissions: s.permissions, features: s.features }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsAttendanceAction: s.attendance }));
vi.mock("@/lib/services/owner-people-reports", () => ({ getMembersReport: s.members, getStaffReport: s.staff }));
vi.mock("@/lib/services/owner-batch-report", () => ({ getOwnerBatchReport: s.batches }));
vi.mock("@/lib/services/owner-home-charts", () => ({ getOwnerCharts: s.charts }));
vi.mock("@/lib/actions/owner-reports", () => ({ getEnquiryFunnelAction: s.enquiry, getRetentionViewAction: s.retention, getCoachLoadAction: s.coach, getFacilityUtilisationAction: s.utilisation }));
vi.mock("@/lib/actions/owner-analytics", () => ({ getMoneyAnalyticsAction: s.money }));
// Legacy cards are async server components; jsdom cannot render them directly.
vi.mock("@/components/reports/enquiry-funnel-card", () => ({ EnquiryFunnelCard: ({ rows }: { rows: unknown[] }) => <article aria-label="Enquiry funnel">{rows.length} sources</article> }));
vi.mock("@/components/reports/coach-load-card", () => ({ CoachLoadCard: ({ rows }: { rows: unknown[] }) => <article aria-label="Coach load">{rows.length} assignments</article> }));
import ReportsPage from "@/app/(owner)/owner/reports/page";

beforeEach(() => {
  s.permissions.clear(); ["reports.operational", "reports.financial", "invoices.read", "staff.attendance"].forEach(p => s.permissions.add(p));
  s.features.clear(); ["reports", "billing"].forEach(f => s.features.add(f));
  s.attendance.mockReset().mockResolvedValue({ summary: { marks: { present: 6, late: 2, absent: 2, total: 10 }, register: { completedRegisters: 1, sessionsWithRoster: 2, unmarkedSlots: 2 } }, rows: [] });
  s.members.mockReset().mockResolvedValue({ statuses: [{ status: "active", count: 7 }], joined: 2, joinedUnknown: 0, joinedByDay: [] });
  s.staff.mockReset().mockResolvedValue({ attendance: [{ checkedIn: true }], shifts: [] });
  s.batches.mockReset().mockResolvedValue([{ reservedPlaces: 4, capacity: 10 }]);
  s.charts.mockReset().mockResolvedValue({ collections: { paymentCount: 3 } });
  s.enquiry.mockReset().mockResolvedValue([]);
  s.retention.mockReset().mockResolvedValue({ row: { memberCountAtRisk: 0, membersWithZeroLast30: 0, membersWithPartialLast30: 0, totalActiveMembers: 0 }, eligibleMemberCount: 0, sessionsInWindow: 0, history: "insufficient" });
  s.coach.mockReset().mockResolvedValue([]);
  s.utilisation.mockReset().mockResolvedValue({ fromDate: "2026-09-01", toDate: "2026-09-28", weeks: 4, businessHoursConfigured: false, facilities: [], byDay: [], byHour: [], emptiest: null });
  s.money.mockReset().mockResolvedValue({ collections: { totalPaise: 0, byDay: [], expensesPaise: null }, planRevenue: [] });
});
afterEach(() => { cleanup(); window.localStorage.removeItem("aqua:owner-report-preferences:tenant:user"); });

describe("ReportsPage resilience and scope", () => {
  it.each([
    ["attendance", s.attendance, /Attendance/, /Could not load attendance/],
    ["members", s.members, /Members/, /Unavailable/],
    ["staff", s.staff, /Staff check-ins/, /Unavailable/],
    ["batches", s.batches, /Batches places/, /Unavailable/],
    ["payments", s.charts, /Payments recorded/, /Unavailable/],
  ])("shows %s failure without blanking other authorized cards", async (_name, failing, linkName, failure) => {
    failing.mockRejectedValueOnce(new Error("read failed"));
    render(await ReportsPage({}));
    expect(within(screen.getByRole("link", { name: linkName })).getByText(failure)).toBeTruthy();
    expect(within(screen.getByRole("link", { name: linkName })).getByText("Unavailable")).toBeTruthy();
    if (_name !== "attendance") expect(screen.getByText("80%")).toBeTruthy();
    if (_name !== "members") expect(within(screen.getByRole("link", { name: /Members/ })).getByText("7")).toBeTruthy();
    if (_name !== "payments") expect(within(screen.getByRole("link", { name: /Payments recorded/ })).getByText("3")).toBeTruthy();
  });

  it("renders one accurate attendance lead and keeps secondary reports in a closed disclosure", async () => {
    render(await ReportsPage({}));
    expect(screen.getAllByRole("heading", { name: "Attendance" })).toHaveLength(1);
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("8 of 10 recorded marks present or late")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Attendance trend" })).toBeNull();
    const more = screen.getByText("More reports").closest("details");
    expect(more?.open).toBe(false);
    expect(s.enquiry).toHaveBeenCalledOnce(); expect(s.retention).toHaveBeenCalledOnce(); expect(s.coach).toHaveBeenCalledOnce();
    expect(s.utilisation).toHaveBeenCalledOnce(); expect(s.money).toHaveBeenCalledOnce();
  });

  it("does not query tenant-wide-only reports under a selected facility", async () => {
    const facility = "11111111-1111-4111-8111-111111111111";
    render(await ReportsPage({ searchParams: Promise.resolve({ facility }) }));
    expect(s.enquiry).not.toHaveBeenCalled(); expect(s.retention).not.toHaveBeenCalled(); expect(s.coach).not.toHaveBeenCalled();
    expect(s.attendance).toHaveBeenCalledWith(expect.objectContaining({ locationId: facility }));
    expect(screen.getByText(/Some reports are unavailable for a selected facility/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Asia\/(Kolkata|Calcutta)/);
  });

  it.each(["reports.financial", "invoices.read", "billing"])('never calls finance without required %s', async missing => {
    if (missing === "billing") s.features.delete(missing); else s.permissions.delete(missing);
    render(await ReportsPage({}));
    expect(s.charts).not.toHaveBeenCalled(); expect(s.money).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Payments recorded/ })).toBeNull();
    expect(screen.getByText("80%")).toBeTruthy();
  });

  it("does not start report reads when the reports feature is disabled", async () => {
    s.features.delete("reports");
    render(await ReportsPage({}));
    expect(screen.getByRole("alert").textContent).toMatch(/reports are unavailable/i);
    expect(s.attendance).not.toHaveBeenCalled(); expect(s.members).not.toHaveBeenCalled();
    expect(s.charts).not.toHaveBeenCalled(); expect(s.money).not.toHaveBeenCalled();
  });

  it("does not query staff reports without staff attendance permission", async () => {
    s.permissions.delete("staff.attendance");
    render(await ReportsPage({}));
    expect(s.staff).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Staff check-ins/ })).toBeNull();
    expect(screen.getByText("80%")).toBeTruthy();
  });

  it("shows individual legacy report read failures rather than silently treating them as empty", async () => {
    s.enquiry.mockRejectedValueOnce(new Error("failed")); s.retention.mockRejectedValueOnce(new Error("failed"));
    s.coach.mockRejectedValueOnce(new Error("failed")); s.utilisation.mockRejectedValueOnce(new Error("failed")); s.money.mockRejectedValueOnce(new Error("failed"));
    render(await ReportsPage({}));
    for (const text of ["Enquiry report unavailable.", "Attendance records unavailable.", "Coach load unavailable.", "Utilisation unavailable.", "Plan revenue unavailable."]) expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
  });
});
