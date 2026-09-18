"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listInvoicePayments,
  recordPayment,
  MAX_PAYMENT_PAISE,
  type PaymentRow,
  type RecordPaymentResult,
} from "@/lib/services/payments";

// C-33 — payment actions. Recording needs payments.record (reception,
// accountant, owner, admin). Reading an invoice's payments rides
// invoices.read so the same people who see the invoice see its
// payments.

const recordInput = z.object({
  invoiceId: z.string().uuid(),
  amountPaise: z.number().int().positive().max(MAX_PAYMENT_PAISE),
  method: z.enum(["cash", "upi", "bank_transfer", "card", "other"]),
  reference: z.string().trim().min(1).max(120).optional(),
});
const invoiceInput = z.object({ invoiceId: z.string().uuid() });

export async function recordPaymentAction(
  raw: unknown,
): Promise<RecordPaymentResult> {
  const parsed = recordInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid payment input.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return recordPayment(ctx, parsed.data);
}

export async function listInvoicePaymentsAction(
  invoiceId: string,
): Promise<PaymentRow[]> {
  const parsed = invoiceInput.safeParse({ invoiceId });
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return listInvoicePayments(ctx, parsed.data.invoiceId);
}
