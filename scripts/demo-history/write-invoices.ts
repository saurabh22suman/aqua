import { and, eq } from "drizzle-orm";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { payments } from "@/db/schema/payments";
import { asMemberId, asUserId } from "@/lib/ids";
import { zonedWallTimeToInstant } from "@/lib/time/tz";
import { allocateInvoiceNumber } from "@/lib/services/invoice-numbering";
import { resolveConfigInTx } from "@/db/config";
import { SAC_CODE_KEY } from "@/lib/services/invoice-issue";
import { GST_RATE_KEY } from "@/lib/services/tax";
import { gstDocumentKind } from "@/lib/gst";
import { computeTax } from "@/lib/money/arithmetic";
import { historyId } from "./keys";
import { auditInstant } from "./audit-instant";
import type { WriteContext } from "./write-context";
import type { HistoryPlan } from "./types";

// The money side: the invoices and the payments that settle them.
//
// The rules are the application's own, not a paraphrase of them:
//
//   * the invoice number comes from the app's gapless per-financial-year
//     counter (allocateInvoiceNumber) — and it is only allocated for an
//     invoice that does not exist yet, so a repeat run burns no numbers;
//   * the document kind follows the tenant's GSTIN (no GSTIN = Bill of
//     Supply = no tax) and the rate comes from the config chain;
//   * the plan price is GST-exclusive, so the tax is added on top and
//     the planned instalments are scaled to the real total;
//   * a payment can never exceed the invoice, cash carries no reference
//     and every other method carries one that is unique per tenant.

export async function writeInvoicesAndPayments(
  ctx: WriteContext,
  subscriptionIds: Map<string, string>,
): Promise<void> {
  const { tx, tenantId, state, plan, counters, existing, audit } = ctx;

  const gstin = state.tenant.gstin;
  const documentKind = gstDocumentKind(gstin);
  const { value: sacCode } = await resolveConfigInTx<string>(
    tx,
    tenantId,
    SAC_CODE_KEY,
  );
  const gstRateBp =
    documentKind === "tax_invoice"
      ? (
          await resolveConfigInTx<number>(tx, tenantId, GST_RATE_KEY, {
            locationId: state.primaryLocationId,
          })
        ).value
      : 0;

  const invoiceRows = await tx
    .select({
      id: invoices.id,
      subscriptionId: invoices.subscriptionId,
      dueOn: invoices.dueOn,
      status: invoices.status,
    })
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId));
  const invoiceByKey = new Map<string, string>();
  for (const row of invoiceRows) {
    if (!row.subscriptionId || row.status === "void") continue;
    invoiceByKey.set(`${row.subscriptionId}|${row.dueOn}`, row.id);
  }

  for (const invoice of plan.invoices) {
    const subscriptionId = subscriptionIds.get(
      `${invoice.memberId}|${invoice.planId}|${invoice.issuedOn}`,
    );
    if (!subscriptionId) continue; // the subscription row is not there
    const naturalKey = `${subscriptionId}|${invoice.dueOn}`;
    if (invoiceByKey.has(naturalKey)) {
      existing.invoices += 1;
      // The invoice and its payments are already there — the repeat run
      // counts them, it does not write them again.
      existing.payments += invoice.payments.length;
      continue;
    }

    const allocated = await allocateInvoiceNumber(
      tx,
      tenantId,
      invoice.issuedOn,
    );
    const taxPaise = computeTax(invoice.totalPaise, gstRateBp);
    const totalPaise = invoice.totalPaise + taxPaise;
    const invoiceId = historyId(state.tenant.id, "invoice", invoice.key);

    const [row] = await tx
      .insert(invoices)
      .values({
        id: invoiceId,
        tenantId,
        locationId: state.primaryLocationId,
        memberId: asMemberId(invoice.memberId),
        subscriptionId,
        invoiceNumber: allocated.invoiceNumber,
        financialYear: allocated.financialYear,
        issuedOn: invoice.issuedOn,
        dueOn: invoice.dueOn,
        subtotalPaise: BigInt(invoice.totalPaise),
        taxPaise: BigInt(taxPaise),
        totalPaise: BigInt(totalPaise),
        paidPaise: 0n,
        status: "issued",
        source: "membership",
        gstin,
        notes: "Synthetic demo history — membership dues.",
      })
      .onConflictDoNothing()
      .returning({ id: invoices.id });
    if (!row) {
      existing.invoices += 1;
      continue;
    }
    counters.invoices += 1;
    invoiceByKey.set(naturalKey, row.id);

    const lineRows = await tx
      .insert(invoiceLineItems)
      .values({
        tenantId,
        invoiceId: row.id,
        description: invoice.description,
        sacCode,
        amountPaise: BigInt(invoice.totalPaise),
        taxRateBp: gstRateBp,
        taxPaise: BigInt(taxPaise),
      })
      .onConflictDoNothing()
      .returning({ id: invoiceLineItems.id });
    counters.invoiceLines += lineRows.length;

    audit.push({
      action: "invoice.issue",
      entityType: "invoice",
      entityId: row.id,
      after: {
        invoiceNumber: allocated.invoiceNumber,
        documentKind,
        source: "membership",
        subtotalPaise: invoice.totalPaise,
        taxPaise,
        totalPaise,
        subscriptionId,
        synthetic: true,
      },
      createdAt: auditInstant(
        zonedWallTimeToInstant(
          invoice.issuedOn,
          "09:00",
          state.tenant.timezone,
        ).toISOString(),
        ctx.nowMs,
      ),
    });

    const scaled = scalePayments(invoice, totalPaise);
    let paidPaise = 0;
    for (const payment of scaled) {
      const [paymentRow] = await tx
        .insert(payments)
        .values({
          id: historyId(state.tenant.id, "payment", payment.key),
          tenantId,
          invoiceId: row.id,
          memberId: asMemberId(invoice.memberId),
          locationId: state.primaryLocationId,
          amountPaise: BigInt(payment.amountPaise),
          method: payment.method,
          channel: "counter",
          receivedAt: new Date(payment.receivedAtIso),
          receivedBy: state.receiverUserId
            ? asUserId(state.receiverUserId)
            : null,
          reference: payment.reference,
          status: "captured",
        })
        .onConflictDoNothing()
        .returning({ id: payments.id });
      if (!paymentRow) {
        existing.payments += 1;
        continue;
      }
      counters.payments += 1;
      paidPaise += payment.amountPaise;
      audit.push({
        action: "payment.record",
        entityType: "payment",
        entityId: paymentRow.id,
        after: {
          invoiceId: row.id,
          amountPaise: payment.amountPaise,
          method: payment.method,
          reference: payment.reference,
          synthetic: true,
        },
        createdAt: auditInstant(payment.receivedAtIso, ctx.nowMs),
      });
    }

    const status =
      paidPaise === totalPaise ? "paid" : paidPaise > 0 ? "partial" : "issued";
    await tx
      .update(invoices)
      .set({ paidPaise: BigInt(paidPaise), status })
      .where(and(eq(invoices.id, row.id), eq(invoices.tenantId, tenantId)));
  }
}

/**
 * The planner works in plan prices; the invoice carries GST on top.
 * Scale the planned instalments to the invoice's real total so the
 * payments still add up to it exactly.
 *
 * The rounding drift is measured against the amount the invoice is
 * ACTUALLY PAID, never against the invoice's full total. A part-paid
 * invoice is part-paid: half of ₹10,000 with 18 % GST is ₹5,900 paid
 * on an ₹11,800 invoice, not ₹11,800 paid on an ₹11,800 invoice. The
 * difference between the two is the whole point of the dues list — a
 * part-paid invoice that turns into a paid one loses the balance the
 * owner still has to chase.
 *
 * Exported for the test that pins these numbers.
 */
export function scalePayments(
  invoice: HistoryPlan["invoices"][number],
  totalPaise: number,
): HistoryPlan["invoices"][number]["payments"] {
  if (invoice.payments.length === 0) return [];
  if (invoice.totalPaise === totalPaise) return invoice.payments;
  const scaled = invoice.payments.map((payment) => ({
    ...payment,
    amountPaise: Math.round(
      (payment.amountPaise * totalPaise) / invoice.totalPaise,
    ),
  }));
  // What the invoice is really worth as far as the ledger is concerned:
  // the planned paid amount, scaled by the same factor.
  const intendedPaid = Math.round(
    (invoice.paidPaise * totalPaise) / invoice.totalPaise,
  );
  const drift =
    intendedPaid - scaled.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const last = scaled[scaled.length - 1]!;
  scaled[scaled.length - 1] = {
    ...last,
    amountPaise: last.amountPaise + drift,
  };
  return scaled;
}
