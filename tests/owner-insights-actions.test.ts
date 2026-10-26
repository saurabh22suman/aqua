// @vitest-environment node
//
// The owner-insight Server Actions: parse → session → permission →
// service, with the COMPLETE session context forwarded.
//
// The failure class this file exists to catch is the A01/A07 one: an
// adapter that rebuilds a narrowed ctx (`{ tenantId, userId }`) drops
// the caller's location scope and permission set before the service
// can enforce them. The service gate cannot see what the adapter
// threw away.
//
// Harness: the mocked pattern from tests/review-action-context-forwarding
// .test.ts — the auth context, the permission resolver and the service
// are mocked, so the assertions are about the adapter's wiring, not
// about service behaviour (the service is covered against a real
// database in tests/owner-insights.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  permission: vi.fn(),
  getAttendanceByBatch: vi.fn(),
  getEnquiryStageBreakdown: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.ctx }));
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: mocks.permission,
  ForbiddenError: class ForbiddenError extends Error {},
}));
// The real input schema is kept — "validated inputs" means the action
// really parses, not that a mock accepts anything.
vi.mock("@/lib/services/owner-insights", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/owner-insights")>();
  return {
    ...actual,
    getAttendanceByBatch: mocks.getAttendanceByBatch,
    getEnquiryStageBreakdown: mocks.getEnquiryStageBreakdown,
  };
});

const {
  getOwnerInsightsAttendanceAction,
  getOwnerInsightsEnquiryStagesAction,
} = await import("@/lib/actions/owner-insights");

const PERIOD = { from: "2026-06-01", to: "2026-07-01" };

// The complete authenticated context: user, role, permissions AND the
// location scope the caller was resolved with.
const fullCtx = {
  tenantId: asTenantId("11111111-1111-4111-8111-111111111111"),
  userId: asUserId("22222222-2222-4222-8222-222222222222"),
  roleKey: "admin",
  allLocations: false,
  locationIds: ["33333333-3333-4333-8333-333333333333"],
  permissions: new Set(["reports.operational"]),
  features: new Set(["reports"]),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ctx.mockResolvedValue(fullCtx);
  mocks.permission.mockImplementation(() => {});
  mocks.getAttendanceByBatch.mockResolvedValue({ rows: [] });
  mocks.getEnquiryStageBreakdown.mockResolvedValue({ rows: [] });
});

describe("owner insights Server Actions — the adapter contract", () => {
  it("validates the input before the session is resolved", async () => {
    // The message matters: "the input was rejected by the schema" is a
    // different outcome from "the action is not implemented".
    await expect(
      getOwnerInsightsAttendanceAction({ from: "2026-07-01", to: "2026-06-01" }),
    ).rejects.toThrow(/period end must be after/i);
    await expect(
      getOwnerInsightsEnquiryStagesAction({ from: "not-a-date", to: "2026-07-01" }),
    ).rejects.toThrow(/YYYY-MM-DD/i);

    // A bad window never reaches the session, the permission check or
    // the service.
    expect(mocks.ctx).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.getAttendanceByBatch).not.toHaveBeenCalled();
    expect(mocks.getEnquiryStageBreakdown).not.toHaveBeenCalled();
  });

  it("refuses a date the calendar does not have, before the session is resolved", async () => {
    // 2026-02-30 never happened. A window naming it must not reach
    // the session, the permission check or the service — otherwise the
    // club gets an honest-looking empty chart for a day that does not
    // exist.
    await expect(
      getOwnerInsightsAttendanceAction({ from: "2026-02-30", to: "2026-07-01" }),
    ).rejects.toThrow(/YYYY-MM-DD/i);
    await expect(
      getOwnerInsightsEnquiryStagesAction({ from: "2026-06-01", to: "2026-13-01" }),
    ).rejects.toThrow(/YYYY-MM-DD/i);

    expect(mocks.ctx).not.toHaveBeenCalled();
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.getAttendanceByBatch).not.toHaveBeenCalled();
    expect(mocks.getEnquiryStageBreakdown).not.toHaveBeenCalled();
  });

  it("accepts a real leap day", async () => {
    // 2024 is a leap year: February 29 exists and must not be
    // over-rejected by the calendar check.
    await getOwnerInsightsAttendanceAction({ from: "2024-02-29", to: "2024-03-01" });
    expect(mocks.getAttendanceByBatch).toHaveBeenCalledTimes(1);
  });

  it("checks the operational-reports permission against the session", async () => {
    await getOwnerInsightsAttendanceAction(PERIOD);
    expect(mocks.permission).toHaveBeenCalledWith(fullCtx, "reports.operational");

    await getOwnerInsightsEnquiryStagesAction(PERIOD);
    expect(mocks.permission).toHaveBeenCalledWith(fullCtx, "reports.operational");
  });

  it("hands the service the COMPLETE session context", async () => {
    await getOwnerInsightsAttendanceAction(PERIOD);

    expect(mocks.getAttendanceByBatch).toHaveBeenCalledTimes(1);
    const [ctx, input] = mocks.getAttendanceByBatch.mock.calls[0]!;
    // The same object, not a narrowed rebuild: the location scope and
    // the permission set must survive the hop.
    expect(ctx).toBe(fullCtx);
    expect((ctx as typeof fullCtx).locationIds).toEqual(fullCtx.locationIds);
    expect((ctx as typeof fullCtx).permissions).toBe(fullCtx.permissions);
    expect(input).toEqual(PERIOD);
  });

  it("hands the enquiry service the COMPLETE session context", async () => {
    await getOwnerInsightsEnquiryStagesAction(PERIOD);

    expect(mocks.getEnquiryStageBreakdown).toHaveBeenCalledTimes(1);
    const [ctx] = mocks.getEnquiryStageBreakdown.mock.calls[0]!;
    expect(ctx).toBe(fullCtx);
  });

  it("does not call the service when the permission check rejects", async () => {
    mocks.permission.mockImplementation(() => {
      throw new Error("forbidden: role_grant_missing for permission 'reports.operational'");
    });

    await expect(getOwnerInsightsAttendanceAction(PERIOD)).rejects.toThrow(/forbidden/);
    await expect(getOwnerInsightsEnquiryStagesAction(PERIOD)).rejects.toThrow(/forbidden/);

    expect(mocks.getAttendanceByBatch).not.toHaveBeenCalled();
    expect(mocks.getEnquiryStageBreakdown).not.toHaveBeenCalled();
  });
});
