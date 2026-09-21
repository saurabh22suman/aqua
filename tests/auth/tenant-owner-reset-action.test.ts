// @vitest-environment node
//
// PR2-C4 — tenant-side owner reset action. Thin wrapper: parse ->
// tenant session + permission -> service. The service and the link
// semantics are covered by tests/auth/owner-reset-link.test.ts; this
// pins the action's guards and forwarding.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDefaultCtx = vi.fn();
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: (...args: unknown[]) => requireDefaultCtx(...args),
}));

const requirePermission = vi.fn();
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));

const issueTenantOwnerResetLink = vi.fn();
vi.mock("@/lib/services/owner-reset", () => ({
  issueTenantOwnerResetLink: (...args: unknown[]) =>
    issueTenantOwnerResetLink(...args),
}));

import { issueTenantOwnerResetLinkAction } from "@/lib/actions/tenant-owner-reset";

const MEMBERSHIP_ID = "11111111-1111-7111-8111-111111111111";
const ctx = { tenantId: "22222222-2222-7222-8222-222222222222", userId: "u1" };

describe("issueTenantOwnerResetLinkAction (PR2-C4)", () => {
  beforeEach(() => {
    requireDefaultCtx.mockReset();
    requirePermission.mockReset();
    issueTenantOwnerResetLink.mockReset();
  });

  it("rejects malformed input before any permission or service call", async () => {
    const result = await issueTenantOwnerResetLinkAction({ membershipId: "nope" });
    expect(result.kind).toBe("error");
    expect(requireDefaultCtx).not.toHaveBeenCalled();
    expect(issueTenantOwnerResetLink).not.toHaveBeenCalled();
  });

  it("requires staff.invite before touching the service", async () => {
    requireDefaultCtx.mockResolvedValue(ctx);
    issueTenantOwnerResetLink.mockResolvedValue({
      kind: "ok",
      token: "tok",
      urlPath: "/login/link/tok",
      purpose: "reset",
      expiresAt: new Date(),
      phone: "+919000000001",
      roleKey: "owner",
      tenantName: "Demo",
    });

    const result = await issueTenantOwnerResetLinkAction({
      membershipId: MEMBERSHIP_ID,
    });

    expect(requirePermission).toHaveBeenCalledWith(ctx, "staff.invite");
    expect(result.kind).toBe("ok");
    expect(issueTenantOwnerResetLink).toHaveBeenCalledWith(ctx, MEMBERSHIP_ID);
  });

  it("propagates a permission refusal without calling the service", async () => {
    requireDefaultCtx.mockResolvedValue(ctx);
    requirePermission.mockImplementation(() => {
      throw new Error("Forbidden");
    });

    await expect(
      issueTenantOwnerResetLinkAction({ membershipId: MEMBERSHIP_ID }),
    ).rejects.toThrow("Forbidden");
    expect(issueTenantOwnerResetLink).not.toHaveBeenCalled();
  });

  it("propagates the service's refusal unchanged", async () => {
    requireDefaultCtx.mockResolvedValue(ctx);
    issueTenantOwnerResetLink.mockResolvedValue({
      kind: "error",
      code: "not_owner",
      message: "Reset links are issued to owners only.",
    });

    const result = await issueTenantOwnerResetLinkAction({
      membershipId: MEMBERSHIP_ID,
    });
    expect(result).toMatchObject({ kind: "error", code: "not_owner" });
  });
});
