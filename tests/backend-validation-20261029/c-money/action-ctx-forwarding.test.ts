// @vitest-environment node
//
// Lane c-money — the owner report/analytics adapters must hand the
// service the COMPLETE authenticated context (F-04).
//
// The A01/A07 failure class: an adapter that rebuilds a narrowed
// `{ tenantId }` literal drops the caller's allLocations / locationIds
// before the service can apply the location boundary. Two consequences
// were live in this lane:
//   * the owner money analytics and the owner reports could not see
//     the boundary at all (the service was never given it), and
//   * the facility-utilisation report — whose service DOES resolve the
//     access — received a ctx with no user and no location list, so it
//     resolved an EMPTY location set and returned nothing for any
//     tenant with location scoping on.
//
// The same shape as tests/review-action-context-forwarding.test.ts:
// auth context and permission are mocked and the service modules are
// mocked, so the assertion is about the adapter's wiring.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  permission: vi.fn(),
  getMoneyAnalytics: vi.fn(),
  getOperationalAnalytics: vi.fn(),
  getEnquiryFunnel: vi.fn(),
  getRetentionReport: vi.fn(),
  getCoachLoad: vi.fn(),
  getAttendanceReport: vi.fn(),
  getFacilityUtilisation: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.ctx }));
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: mocks.permission,
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("@/lib/services/owner-analytics", () => ({
  getMoneyAnalytics: mocks.getMoneyAnalytics,
  getOperationalAnalytics: mocks.getOperationalAnalytics,
}));
vi.mock("@/lib/services/owner-reports", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/owner-reports")>();
  return {
    ...actual,
    getEnquiryFunnel: mocks.getEnquiryFunnel,
    getRetentionReport: mocks.getRetentionReport,
    getCoachLoad: mocks.getCoachLoad,
    getAttendanceReport: mocks.getAttendanceReport,
  };
});
vi.mock("@/lib/services/utilisation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/utilisation")>();
  return { ...actual, getFacilityUtilisation: mocks.getFacilityUtilisation };
});

const ctx = {
  tenantId: asTenantId("00000000-0000-4000-8000-000000000001"),
  userId: asUserId("00000000-0000-4000-8000-000000000002"),
  membershipId: "00000000-0000-4000-8000-00000000000a",
  roleKey: "admin",
  roleId: "00000000-0000-4000-8000-00000000000b",
  slug: "",
  allLocations: false,
  locationIds: ["00000000-0000-4000-8000-000000000003"],
  permissions: new Set([
    "dashboard.view",
    "reports.financial",
    "reports.operational",
    "payments.read",
  ]),
  features: new Set(["staff"]),
  requestId: "00000000-0000-4000-8000-000000000004",
};

const period = { from: "2026-10-01", to: "2026-11-01" };

function expectCompleteCtx(received: unknown): void {
  expect(received).toBe(ctx);
  expect(received).toMatchObject({
    userId: ctx.userId,
    roleKey: "admin",
    allLocations: false,
    locationIds: ctx.locationIds,
    permissions: ctx.permissions,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ctx.mockResolvedValue(ctx);
  mocks.permission.mockReturnValue(undefined);
  mocks.getMoneyAnalytics.mockResolvedValue({ collections: { byDay: [] } });
  mocks.getOperationalAnalytics.mockResolvedValue({ memberMix: [] });
  mocks.getEnquiryFunnel.mockResolvedValue([]);
  mocks.getRetentionReport.mockResolvedValue({ row: {} });
  mocks.getCoachLoad.mockResolvedValue([]);
  mocks.getAttendanceReport.mockResolvedValue([]);
  mocks.getFacilityUtilisation.mockResolvedValue({});
});

describe("owner report adapters forward the complete ctx (F-04)", () => {
  it("getMoneyAnalyticsAction forwards the complete ctx", async () => {
    const { getMoneyAnalyticsAction } = await import("@/lib/actions/owner-analytics");
    await getMoneyAnalyticsAction(period);
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "reports.financial");
    const [receivedCtx, receivedPeriod, receivedOptions] =
      mocks.getMoneyAnalytics.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(receivedPeriod).toEqual(period);
    expect(receivedOptions).toEqual({ locationId: undefined });
  });

  it("getOperationalAnalyticsAction forwards the complete ctx", async () => {
    const { getOperationalAnalyticsAction } = await import(
      "@/lib/actions/owner-analytics"
    );
    await getOperationalAnalyticsAction(period);
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "reports.operational");
    const [receivedCtx] = mocks.getOperationalAnalytics.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
  });

  it("getEnquiryFunnelAction forwards the complete ctx", async () => {
    const { getEnquiryFunnelAction } = await import("@/lib/actions/owner-reports");
    await getEnquiryFunnelAction(period);
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "reports.operational");
    const [receivedCtx, receivedPeriod] = mocks.getEnquiryFunnel.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(receivedPeriod).toEqual(period);
  });

  it("getRetentionViewAction forwards the complete ctx", async () => {
    const { getRetentionViewAction } = await import("@/lib/actions/owner-reports");
    await getRetentionViewAction();
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "reports.operational");
    const [receivedCtx] = mocks.getRetentionReport.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
  });

  it("getCoachLoadAction forwards the complete ctx", async () => {
    const { getCoachLoadAction } = await import("@/lib/actions/owner-reports");
    await getCoachLoadAction(period);
    const [receivedCtx] = mocks.getCoachLoad.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
  });

  it("getFacilityUtilisationAction forwards the complete ctx", async () => {
    const { getFacilityUtilisationAction } = await import(
      "@/lib/actions/owner-reports"
    );
    await getFacilityUtilisationAction({});
    const [receivedCtx] = mocks.getFacilityUtilisation.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
  });

  it("keeps the attendance report and its CSV export on the complete ctx", async () => {
    const {
      getAttendanceReportAction,
      attendanceReportCsvAction,
    } = await import("@/lib/actions/owner-reports");
    await getAttendanceReportAction(period);
    await attendanceReportCsvAction(period);
    for (const call of mocks.getAttendanceReport.mock.calls) {
      expectCompleteCtx(call[0]);
    }
  });
});
