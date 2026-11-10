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
  // F01 — a public payment request MUST carry its operation key. The
  // service keeps it optional for trusted internal callers, but a
  // browser request without one is refused before any write.
  idempotencyKey: z
    .string({
      error:
        "A payment needs its one-time operation key. Refresh and try again.",
    })
    .uuid(
      "A payment needs its one-time operation key. Refresh and try again.",
    ),
  // The recovery read must supply the last committed intent it saw
  // (null = none). A browser that omits this is refused rather than
  // starting a new operation from an unchecked snapshot.
  observedIntentId: z
    .string({
      error:
        "Check the document for an earlier attempt before recording.",
    })
    .uuid("Check the document for an earlier attempt before recording.")
    .nullable(),
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
