import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ctx: { permissions: new Set<string>(), features: new Set<string>(), tenantId: "test", userId: "user-test" }, charts: vi.fn(), enquiries: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => mocks.ctx }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/actions/dashboard", () => ({ getOwnerDashboardAction: async () => ({ today: "2026-10-31" }) }));
vi.mock("@/lib/actions/branding", () => ({ getBrandingAction: async () => ({}) }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({}) }));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/lib/actions/owner-home-charts", () => ({ getOwnerChartsAction: mocks.charts }));
vi.mock("@/lib/actions/tenant-timezone", () => ({ getTenantTimezoneAction: async () => "Asia/Kolkata" }));
vi.mock("@/lib/actions/owner-insights", () => ({ getOwnerInsightsEnquiryStagesAction: mocks.enquiries }));
vi.mock("@/components/owner-dashboard", () => ({ OwnerDashboard: () => null }));
import OwnerHomePage from "@/app/(owner)/owner/page";
const facility = "33333333-3333-4333-8333-333333333333";
beforeEach(() => { vi.clearAllMocks(); mocks.charts.mockResolvedValue(null); mocks.ctx.features = new Set(); mocks.ctx.permissions = new Set(["dashboard.view", "reports.financial", "invoices.read"]); });
describe("Home collection read authorization and period", () => {
  it("requests the actual last-seven read with facility even for a legacy month URL", async () => {
    await OwnerHomePage({ searchParams: Promise.resolve({ period: "month", facility }) });
    expect(mocks.charts).toHaveBeenCalledWith({ period: "last7", facility });
  });
  it("does not read the reports-only enquiry analysis on Home", async () => {
    mocks.ctx.permissions.add("reports.operational");
    mocks.enquiries.mockResolvedValue({ total: 0, rows: [] });
    await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(mocks.enquiries).not.toHaveBeenCalled();
  });
  it("passes the authenticated user and tenant to the Home artwork", async () => {
    const page = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(page.props.artworkIdentity).toEqual({ tenantId: "test", userId: "user-test" });
  });
  it("requires booking read, write and entitlement for the quick action", async () => {
    mocks.ctx.permissions.add("bookings.read");
    const withoutFeature = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(withoutFeature.props.can.bookCourt).toBe(false);
    mocks.ctx.features.add("pool.booking");
    const withoutWrite = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(withoutWrite.props.can.bookCourt).toBe(false);
    mocks.ctx.permissions.add("bookings.write");
    const allowed = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(allowed.props.can.bookCourt).toBe(true);
    mocks.ctx.permissions.delete("bookings.read");
    const withoutGrant = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(withoutGrant.props.can.bookCourt).toBe(false);
    mocks.ctx.permissions.add("bookings.read");
    mocks.ctx.features.delete("pool.booking");
    const withoutEntitlement = await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(withoutEntitlement.props.can.bookCourt).toBe(false);
  });
  it("does not request collections without both financial grants", async () => {
    mocks.ctx.permissions = new Set(["dashboard.view", "invoices.read"]);
    await OwnerHomePage({ searchParams: Promise.resolve({}) });
    expect(mocks.charts).not.toHaveBeenCalled();
  });
});
