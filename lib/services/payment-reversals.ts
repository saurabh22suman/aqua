import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { paymentReversals } from "@/db/schema/payment-reversals";
import { invoices } from "@/db/schema/invoices";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { formatINR } from "@/lib/money/format";
import type { ActionCtx } from "@/lib/auth/context";

// PR2-C8 — payment reversals. The original payment row is immutable;
// a reversal is a new row and the invoice's paid/outstanding figures
// are recomputed under the invoice row lock, so two desks reversing
// the same payment cannot both win the same remaining amount.

const reverseInput = z.object({
  paymentId: z.string().uuid(),
  amountPaise: z.number().int().positive().max(10_000_000_000),
  reason: z.string().trim().min(3, "Give a reason (3-300 characters).").max(300),
});

export type ReversePaymentInput = z.input<typeof reverseInput>;

export type ReversePaymentResult =
  | { ok: true; id: string; invoiceStatus: "issued" | "partial" | "paid" }
  | { ok: false; error: string };

export async function reversePayment(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ReversePaymentResult> {
  const parsed = reverseInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid reversal.",
    };
  }
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const paymentRows = await tx
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.tenantId, ctx.tenantId),
        ),
      )
      .for("update");
    const payment = paymentRows[0];
    if (!payment || !locationVisible(access, payment.locationId)) {
      return { ok: false, error: "Payment not found." };
    }
    if (payment.status !== "captured") {
      return {
        ok: false,
        error: "Only a captured payment can be reversed.",
      };
    }

    const [{ reversed }] = await tx
      .select({
        reversed: sql<string>`coalesce(sum(${paymentReversals.amountPaise}), 0)::text`,
      })
      .from(paymentReversals)
      .where(
        and(
          eq(paymentReversals.paymentId, payment.id),
          eq(paymentReversals.tenantId, ctx.tenantId),
        ),
      );
    const remaining = Number(payment.amountPaise) - Number(reversed);
    if (remaining <= 0) {
      return { ok: false, error: "This payment is already fully reversed." };
    }
    if (input.amountPaise > remaining) {
      return {
        ok: false,
        error: `That is more than the remaining ${formatINR(remaining)} on this payment.`,
      };
    }

    const [reversal] = await tx
      .insert(paymentReversals)
      .values({
        tenantId: ctx.tenantId,
        paymentId: payment.id,
        amountPaise: BigInt(input.amountPaise),
        reason: input.reason,
        reversedBy: actorId,
        createdBy: actorId,
        updatedBy: actorId,
      })
      .returning({ id: paymentReversals.id });
    if (!reversal) return { ok: false, error: "The reversal could not be saved." };

    let invoiceStatus: "issued" | "partial" | "paid" = "issued";
    if (payment.invoiceId) {
      const invoiceRows = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.id, payment.invoiceId),
            eq(invoices.tenantId, ctx.tenantId),
          ),
        )
        .for("update");
      const invoice = invoiceRows[0];
      if (invoice) {
        const newPaid = Math.max(
          0,
          Number(invoice.paidPaise) - input.amountPaise,
        );
        const total = Number(invoice.totalPaise);
        invoiceStatus =
          newPaid <= 0 ? "issued" : newPaid >= total ? "paid" : "partial";
        await tx
          .update(invoices)
          .set({
            paidPaise: BigInt(newPaid),
            status: invoiceStatus,
            updatedBy: actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(invoices.id, invoice.id),
              eq(invoices.tenantId, ctx.tenantId),
            ),
          );
      }
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "payment.reverse",
      entityType: "payment",
      entityId: payment.id,
      before: {
        paymentStatus: payment.status,
        reversedPaise: Number(reversed),
      },
      after: {
        reversedPaise: Number(reversed) + input.amountPaise,
        amountPaise: input.amountPaise,
        reason: input.reason,
        invoiceStatus,
      },
    });

    return { ok: true, id: reversal.id, invoiceStatus };
  });
}

export type PaymentReversalRow = {
  id: string;
  amountPaise: number;
  reason: string;
  reversedAt: string;
};

export async function listPaymentReversals(
  ctx: Pick<ActionCtx, "tenantId">,
  paymentId: string,
): Promise<PaymentReversalRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: paymentReversals.id,
        amountPaise: paymentReversals.amountPaise,
        reason: paymentReversals.reason,
        reversedAt: paymentReversals.createdAt,
      })
      .from(paymentReversals)
      .where(
        and(
          eq(paymentReversals.tenantId, ctx.tenantId),
          eq(paymentReversals.paymentId, paymentId),
        ),
      )
      .orderBy(paymentReversals.createdAt);
    return rows.map((row) => ({
      id: row.id,
      amountPaise: Number(row.amountPaise),
      reason: row.reason,
      reversedAt: row.reversedAt.toISOString(),
    }));
  });
}
