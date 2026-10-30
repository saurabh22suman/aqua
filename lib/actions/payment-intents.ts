"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelPaymentIntent,
  listPaymentIntentRecovery,
  type CancelIntentResult,
  type PaymentIntentRecovery,
} from "@/lib/services/payment-intent-recovery";

// F01 — the authenticated, read-only recovery surface, plus the explicit
// discard of ONE prepared attempt. The target and intent ids are parsed
// first; the permission check comes from the same document the operation
// belongs to:
//
//   payment attempt  — read invoices.read,   discard payments.record
//   reversal attempt — read payments.read,   discard payments.refund
//
// The service re-checks the actor and the target's CURRENT location
// scope, so a caller whose access was narrowed cannot recover or discard
// another location's attempt.

const targetInput = z.object({ targetId: z.string().uuid() });
const intentInput = z.object({ intentId: z.string().uuid() });

const EMPTY: PaymentIntentRecovery = { open: null, lastCommitted: null };

export async function listPaymentRecoveryAction(
  raw: unknown,
): Promise<PaymentIntentRecovery> {
  const parsed = targetInput.safeParse(raw);
  if (!parsed.success) return EMPTY;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return listPaymentIntentRecovery(ctx, "payment", parsed.data.targetId);
}

export async function listReversalRecoveryAction(
  raw: unknown,
): Promise<PaymentIntentRecovery> {
  const parsed = targetInput.safeParse(raw);
  if (!parsed.success) return EMPTY;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.read");
  return listPaymentIntentRecovery(ctx, "reversal", parsed.data.targetId);
}

export async function cancelPaymentRecoveryAction(
  raw: unknown,
): Promise<CancelIntentResult> {
  const parsed = intentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Attempt not found." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return cancelPaymentIntent(ctx, "payment", parsed.data.intentId);
}

export async function cancelReversalRecoveryAction(
  raw: unknown,
): Promise<CancelIntentResult> {
  const parsed = intentInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Attempt not found." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.refund");
  return cancelPaymentIntent(ctx, "reversal", parsed.data.intentId);
}
