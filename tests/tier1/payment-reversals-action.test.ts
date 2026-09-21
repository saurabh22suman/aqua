// @vitest-environment node
//
// PR2-C8 — reversal action gate. Thin wrapper: parse -> permission ->
// service. Denial for a role without payments.refund (the receptionist)
// is enforced by requirePermission, whose role matrix is pinned in
// tests/tier1/payment-reversals.test.ts and roles-permissions.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireDefaultCtx = vi.fn();
vi.mock("@/lib/auth/context", () => ({
  requireDefaultCtx: (...args: unknown[]) => requireDefaultCtx(...args),
}));

const requirePermission = vi.fn();
vi.mock("@/lib/auth/permission", () => ({
  requirePermission: (...args: unknown[]) => requirePermission(...args),
}));

const reversePayment = vi.fn();
vi.mock("@/lib/services/payment-reversals", () => ({
  reversePayment: (...args: unknown[]) => reversePayment(...args),
}));

import { reversePaymentAction } from "@/lib/actions/payment-reversals";

const PAYMENT_ID = "11111111-1111-7111-8111-111111111111";
const ctx = { tenantId: "22222222-2222-7222-8222-222222222222", userId: "u1" };

describe("reversePaymentAction (PR2-C8)", () => {
  beforeEach(() => {
    requireDefaultCtx.mockReset();
    requirePermission.mockReset();
    reversePayment.mockReset();
  });

  it("rejects malformed input before any permission or service call", async () => {
    const result = await reversePaymentAction({ paymentId: "nope" });
    expect(result.ok).toBe(false);
    expect(requireDefaultCtx).not.toHaveBeenCalled();
    expect(reversePayment).not.toHaveBeenCalled();
  });

  it("requires payments.refund and forwards to the service", async () => {
    requireDefaultCtx.mockResolvedValue(ctx);
    reversePayment.mockResolvedValue({
      ok: true,
      id: "rev-1",
      invoiceStatus: "partial",
    });

    const result = await reversePaymentAction({
      paymentId: PAYMENT_ID,
      amountPaise: 1000,
      reason: "Duplicate entry",
    });

    expect(requirePermission).toHaveBeenCalledWith(ctx, "payments.refund");
    expect(reversePayment).toHaveBeenCalledWith(ctx, {
      paymentId: PAYMENT_ID,
      amountPaise: 1000,
      reason: "Duplicate entry",
    });
    expect(result.ok).toBe(true);
  });

  it("propagates a permission refusal without calling the service", async () => {
    requireDefaultCtx.mockResolvedValue(ctx);
    requirePermission.mockImplementation(() => {
      throw new Error("Forbidden");
    });

    await expect(
      reversePaymentAction({
        paymentId: PAYMENT_ID,
        amountPaise: 1000,
        reason: "Duplicate entry",
      }),
    ).rejects.toThrow("Forbidden");
    expect(reversePayment).not.toHaveBeenCalled();
  });
});
