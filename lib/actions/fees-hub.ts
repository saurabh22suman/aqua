"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { reportPeriodSchema } from "@/lib/services/owner-reports";
import {
  feesInvoiceFilterInput,
  feesTransactionsInput,
  getFeesOverview,
  listDeskDues,
  listHubInvoices,
  listHubTransactions,
  type DeskDueRow,
  type FeesOverview,
  type HubInvoiceRow,
  type HubTransactionRow,
} from "@/lib/services/fees-hub";

// U-02 — Fees & Payments hub actions. Standing preamble: (1) Zod
// parse, (2) permission check. The overview and the transaction
// ledger are financial reads (reports.financial); the invoice and
// dues lists ride invoices.read so the desk roles that raise and
// collect see exactly what they can act on.

const overviewInput = reportPeriodSchema.extend({
  locationId: z.string().uuid().optional(),
});

export async function getFeesOverviewAction(raw: unknown): Promise<FeesOverview> {
  const parsed = overviewInput.safeParse(raw);
  if (!parsed.success) {
    return {
      from: null,
      to: null,
      collectedPaise: 0,
      paymentCount: 0,
      reversedPaise: 0,
      reversalCount: 0,
      outstandingPaise: 0,
      dueInvoiceCount: 0,
      overduePaise: 0,
      overdueInvoiceCount: 0,
      today: "",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "reports.financial");
  return getFeesOverview(ctx, parsed.data, { locationId: parsed.data.locationId });
}

export async function listHubInvoicesAction(
  raw: unknown,
): Promise<HubInvoiceRow[]> {
  const parsed = feesInvoiceFilterInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return listHubInvoices(ctx, parsed.data);
}

export async function listHubTransactionsAction(
  raw: unknown,
): Promise<HubTransactionRow[]> {
  const parsed = feesTransactionsInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.read");
  return listHubTransactions(ctx, parsed.data);
}

// M02 — the reception desk's dues call list, read-only. Same grant the
// desk already uses to see invoices; the service narrows to the
// caller's allowed locations and never returns report aggregates.
export async function listDeskDuesAction(): Promise<DeskDueRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return listDeskDues(ctx);
}
