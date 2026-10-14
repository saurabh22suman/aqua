// @vitest-environment node
//
// Action-adapter ctx forwarding regression (Group-1 remediation review,
// item 7). Every Server Action adapter must:
//   (a) call requirePermission with its approved key,
//   (b) hand the UNDERLYING SERVICE the complete authenticated ctx
//       object — a narrowed `{tenantId, userId, requestId}` literal was
//       exactly the A01/A07 failure class (a restricted caller's
//       allLocations/locationIds/permissions were dropped before the
//       service could enforce location scope),
//   (c) never call the service when requirePermission rejects, even for
//       a partial ctx that still carries a permission set.
//
// Harness: the mocked pattern from tests/review-action-scopes.test.ts —
// auth context/permission and every service module are mocked, so the
// assertions are about the adapters' wiring, not service behaviour.
// RED against HEAD: substituteCoachAction rebuilds a narrowed ctx.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { asTenantId, asUserId } from "@/lib/ids";

const mocks = vi.hoisted(() => ({
  ctx: vi.fn(),
  permission: vi.fn(),
  cancelSession: vi.fn(),
  rescheduleSession: vi.fn(),
  grantMakeup: vi.fn(),
  redeemMakeup: vi.fn(),
  correctAttendance: vi.fn(),
  getOwnerDashboard: vi.fn(),
  voidInvoice: vi.fn(),
  substituteCoach: vi.fn(),
}));

vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: mocks.ctx }));
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: mocks.permission,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("@/db/tenant", () => ({ withTenant: vi.fn(), withUser: vi.fn() }));
vi.mock("@/lib/services/session-lifecycle", () => ({
  cancelSession: mocks.cancelSession,
  rescheduleSession: mocks.rescheduleSession,
}));
vi.mock("@/lib/services/makeup", () => ({
  grantMakeupCredit: mocks.grantMakeup,
  redeemMakeupCredit: mocks.redeemMakeup,
  listMakeupCredits: vi.fn(),
  listMakeupSources: vi.fn(),
  listMakeupTargets: vi.fn(),
}));
vi.mock("@/lib/services/staff-attendance", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/services/staff-attendance")>();
  return { ...actual, correctAttendance: mocks.correctAttendance };
});
vi.mock("@/lib/services/dashboard", () => ({
  getOwnerDashboard: mocks.getOwnerDashboard,
}));
vi.mock("@/lib/services/invoice-mutations", () => ({
  createInvoiceForSubscription: vi.fn(),
  voidInvoice: mocks.voidInvoice,
}));
vi.mock("@/lib/services/coach-substitution", () => ({
  substituteCoach: mocks.substituteCoach,
}));

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
    "programs.write",
    "attendance.mark",
    "staff.attendance",
    "dashboard.view",
    "settings.manage",
  ]),
  features: new Set(["staff"]),
  requestId: "00000000-0000-4000-8000-000000000004",
};

const sessionId = "00000000-0000-4000-8000-000000000005";
const memberId = "00000000-0000-4000-8000-000000000006";
const sourceSessionId = "00000000-0000-4000-8000-000000000007";
const targetSessionId = "00000000-0000-4000-8000-000000000008";
const coachId = "00000000-0000-4000-8000-000000000009";
const invoiceId = "00000000-0000-4000-8000-00000000000c";
const creditId = "00000000-0000-4000-8000-00000000000d";

// Identity plus field presence: narrowing is the regression, so both the
// object identity and the complete-shape fields are asserted.
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
  mocks.cancelSession.mockResolvedValue({
    kind: "ok",
    sessionId,
    newStatus: "cancelled",
    newSessionDate: "2026-12-01",
  });
  mocks.rescheduleSession.mockResolvedValue({
    kind: "ok",
    sessionId,
    newStatus: "scheduled",
    newSessionDate: "2026-12-02",
  });
  mocks.grantMakeup.mockResolvedValue({
    kind: "ok",
    creditId,
    memberId,
    sourceSessionId,
  });
  mocks.redeemMakeup.mockResolvedValue({
    kind: "ok",
    creditId,
    memberId,
    sourceSessionId,
  });
  mocks.correctAttendance.mockResolvedValue({
    ok: true,
    attendanceId: creditId,
  });
  mocks.getOwnerDashboard.mockResolvedValue({});
  mocks.voidInvoice.mockResolvedValue({
    ok: true,
    id: invoiceId,
    invoiceNumber: "INV-1",
  });
  mocks.substituteCoach.mockResolvedValue({
    kind: "ok",
    sessionId,
    newCoachId: coachId,
    previousCoachId: null,
  });
});

describe("review action-adapter context forwarding", () => {
  it("cancelSessionAction requires programs.write and forwards the complete ctx", async () => {
    const { cancelSessionAction } = await import("@/lib/actions/session-lifecycle");
    expect(await cancelSessionAction({ sessionId })).toMatchObject({ kind: "ok" });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "programs.write");
    expect(mocks.cancelSession).toHaveBeenCalledTimes(1);
    const [receivedCtx, receivedSessionId] = mocks.cancelSession.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(receivedSessionId).toBe(sessionId);
  });

  it("rescheduleSessionAction requires programs.write and forwards the complete ctx", async () => {
    const { rescheduleSessionAction } = await import("@/lib/actions/session-lifecycle");
    await rescheduleSessionAction({
      sessionId,
      newSessionDate: "2026-12-02",
      newStartsAt: "2026-12-02T01:30:00Z",
      newEndsAt: "2026-12-02T02:30:00Z",
    });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "programs.write");
    const [receivedCtx, input] = mocks.rescheduleSession.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toMatchObject({ sessionId, newSessionDate: "2026-12-02" });
    expect(input.newStartsAt).toBeInstanceOf(Date);
    expect(input.newEndsAt).toBeInstanceOf(Date);
  });

  it("grantMakeupCreditAction requires programs.write and forwards the complete ctx", async () => {
    const { grantMakeupCreditAction } = await import("@/lib/actions/makeup");
    await grantMakeupCreditAction({ memberId, sourceSessionId });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "programs.write");
    const [receivedCtx, input] = mocks.grantMakeup.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toMatchObject({ memberId, sourceSessionId });
  });

  it("redeemMakeupCreditAction requires attendance.mark and forwards the complete ctx", async () => {
    const { redeemMakeupCreditAction } = await import("@/lib/actions/makeup");
    await redeemMakeupCreditAction({ memberId, sourceSessionId, targetSessionId });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "attendance.mark");
    const [receivedCtx, input] = mocks.redeemMakeup.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toMatchObject({ memberId, sourceSessionId, targetSessionId });
  });

  it("correctStaffAttendanceAction requires staff.attendance and forwards the complete ctx", async () => {
    const { correctStaffAttendanceAction } = await import(
      "@/lib/actions/staff-attendance"
    );
    await correctStaffAttendanceAction({
      staffId: memberId,
      workDate: "2026-10-10",
      status: "present",
      note: "action-adapter regression",
    });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "staff.attendance");
    const [receivedCtx, input] = mocks.correctAttendance.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toMatchObject({
      staffId: memberId,
      workDate: "2026-10-10",
      status: "present",
    });
  });

  it("getOwnerDashboardAction requires dashboard.view and forwards the complete ctx", async () => {
    const { getOwnerDashboardAction } = await import("@/lib/actions/dashboard");
    await getOwnerDashboardAction();
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "dashboard.view");
    const [receivedCtx, input] = mocks.getOwnerDashboard.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toEqual({ locationId: undefined });
  });

  it("voidInvoiceAction requires settings.manage and forwards the complete ctx", async () => {
    const { voidInvoiceAction } = await import("@/lib/actions/invoices");
    await voidInvoiceAction({ invoiceId, reason: "duplicate raise" });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "settings.manage");
    const [receivedCtx, receivedInvoiceId, receivedReason] =
      mocks.voidInvoice.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(receivedInvoiceId).toBe(invoiceId);
    expect(receivedReason).toBe("duplicate raise");
  });

  it("substituteCoachAction requires programs.write and forwards the complete ctx", async () => {
    const { substituteCoachAction } = await import(
      "@/lib/actions/coach-substitution"
    );
    await substituteCoachAction({ sessionId, newCoachId: coachId });
    expect(mocks.permission).toHaveBeenCalledWith(ctx, "programs.write");
    const [receivedCtx, input] = mocks.substituteCoach.mock.calls[0]!;
    expectCompleteCtx(receivedCtx);
    expect(input).toEqual({ sessionId, newCoachId: coachId });
  });

  it("does not call a service when requirePermission rejects a partial ctx", async () => {
    const { ForbiddenError } = await import("@/lib/auth/permission");
    const partialCtx = {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      permissions: new Set(["invoices.read"]),
    };
    mocks.ctx.mockResolvedValue(partialCtx);
    mocks.permission.mockImplementation(() => {
      throw new ForbiddenError("attendance.mark", "role_grant_missing");
    });
    const { redeemMakeupCreditAction } = await import("@/lib/actions/makeup");
    await expect(
      redeemMakeupCreditAction({ memberId, sourceSessionId, targetSessionId }),
    ).rejects.toThrow(ForbiddenError);
    expect(mocks.permission).toHaveBeenCalledWith(partialCtx, "attendance.mark");
    expect(mocks.redeemMakeup).not.toHaveBeenCalled();
  });
});
