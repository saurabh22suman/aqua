"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listPaymentReversals,
  reversePayment,
  type PaymentReversalRow,
  type ReversePaymentResult,
} from "@/lib/services/payment-reversals";

// PR2-C8 — reversal actions. Standing preamble: (1) Zod parse,
// (2) permission check, (3) service. Reversal rides payments.refund,
// which the receptionist deliberately does not hold (recording and
// reversing are different duties).

const reverseFormInput = z.object({
  paymentId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  reason: z.string().trim().min(3).max(300),
});

export async function reversePaymentAction(
  raw: unknown,
): Promise<ReversePaymentResult> {
  // (1) parse
  const parsed = reverseFormInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reversal.",
    };
  }
  // (2) permission: refund is management-only
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.refund");
  // (3) service
  return reversePayment(ctx, parsed.data);
}

export async function listPaymentReversalsAction(
  paymentId: string,
): Promise<PaymentReversalRow[]> {
  const parsed = z.string().uuid().safeParse(paymentId);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.read");
  return listPaymentReversals(ctx, parsed.data);
}
