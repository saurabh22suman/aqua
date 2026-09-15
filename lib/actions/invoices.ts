"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getInvoice,
  listMemberInvoices,
  type InvoiceDetail,
  type InvoiceRow,
} from "@/lib/services/invoices";
import {
  createInvoiceForSubscription,
  voidInvoice,
  type InvoiceMutationResult,
} from "@/lib/services/invoice-mutations";

// C-32 — invoice actions. Standing preamble: (1) parse, (2)
// permission. Reads need invoices.read (reception holds it),
// issue/void need invoices.write (owner/admin/accountant).

const memberInput = z.object({ memberId: z.string().uuid() });
const invoiceInput = z.object({ invoiceId: z.string().uuid() });
const createInput = z.object({
  subscriptionId: z.string().uuid(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const voidInput = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(3).max(300),
});

export async function listMemberInvoicesAction(
  memberId: string,
): Promise<InvoiceRow[]> {
  const parsed = memberInput.safeParse({ memberId });
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return listMemberInvoices(ctx, parsed.data.memberId);
}

export async function getInvoiceAction(
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  const parsed = invoiceInput.safeParse({ invoiceId });
  if (!parsed.success) return null;
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return getInvoice(ctx, parsed.data.invoiceId);
}

export async function createInvoiceAction(
  raw: unknown,
): Promise<InvoiceMutationResult> {
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid invoice request." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.write");
  return createInvoiceForSubscription(ctx, parsed.data);
}

export async function voidInvoiceAction(
  raw: unknown,
): Promise<InvoiceMutationResult> {
  const parsed = voidInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Give a reason (3-300 characters)." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.write");
  return voidInvoice(ctx, parsed.data.invoiceId, parsed.data.reason);
}
