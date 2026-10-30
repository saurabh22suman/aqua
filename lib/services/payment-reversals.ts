import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { paymentReversals } from "@/db/schema/payment-reversals";
import { invoices, type InvoiceStatus } from "@/db/schema/invoices";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { formatINR } from "@/lib/money/format";
import { toSafePaise } from "@/lib/money/safe-paise";
import type { ActionCtx } from "@/lib/auth/context";
import type { PaymentIntent } from "@/db/schema/payment-intents";
import {
  paymentIntentFingerprint,
  lockIntentTarget,
  lockIntentForCommit,
  markIntentCommitted,
  type PaymentIntentConflict,
} from "@/lib/services/payment-intent-core";
import { prepareReversalIntent } from "@/lib/services/payment-intents";

// PR2-C8 — payment reversals. The original payment row is immutable;
// a reversal is a new row and the invoice's paid/outstanding figures
// are recomputed under the invoice row lock, so two desks reversing
// the same payment cannot both win the same remaining amount.

const reverseInput = z.object({
  paymentId: z.string().uuid(),
  amountPaise: z.number().int().positive().max(10_000_000_000),
  reason: z.string().trim().min(3, "Give a reason (3-300 characters).").max(300),
  // F01 — the client-minted operation identity. Optional at the service
  // boundary so trusted internal callers/tests keep working; the public
  // action REQUIRES it.
  idempotencyKey: z.string().uuid().optional(),
  // null or omitted = "no committed intent was observed"; both are
  // validated against the chain, so this cannot fork a second tip.
  observedIntentId: z.string().uuid().nullable().optional(),
});

export type ReversePaymentInput = z.input<typeof reverseInput>;

export type ReversePaymentResult =
  | {
      ok: true;
      id: string;
      // A replay reports the invoice's CURRENT status (a later void is
      // truthful), not the state at reversal.
      invoiceStatus: InvoiceStatus;
      replayed: boolean;
    }
  | { ok: false; error: string; conflict?: PaymentIntentConflict };

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

  // F01 — durable identity before the financial effect, exactly like a
  // payment. A keyless trusted call keeps the pre-F01 behaviour.
  const fingerprint = paymentIntentFingerprint({
    kind: "reversal",
    paymentId: input.paymentId,
    amountPaise: input.amountPaise,
    reason: input.reason,
  });
  let intent: PaymentIntent | null = null;
  if (input.idempotencyKey) {
    const prepared = await prepareReversalIntent(ctx, {
      paymentId: input.paymentId,
      idempotencyKey: input.idempotencyKey,
      fingerprint,
      observedIntentId: input.observedIntentId,
    });
    if (!prepared.ok) {
      return { ok: false, error: prepared.error, conflict: prepared.conflict };
    }
    intent = prepared.intent;
  }

  return withTenant(ctx.tenantId, async (tx) => {
    if (intent) {
      await lockIntentTarget(tx, {
        tenantId: ctx.tenantId,
        actorId,
        kind: "reversal",
        targetId: input.paymentId,
      });
    }
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

    // F01 — lock the intent BEFORE the captured/remaining checks: a
    // late retry replays the recorded reversal even after the payment
    // has been fully reversed, and a concurrent retry waits here and
    // then replays the committed result.
    if (intent) {
      const check = await lockIntentForCommit(tx, {
        tenantId: ctx.tenantId,
        intentId: intent.id,
        actorId,
        kind: "reversal",
        targetId: payment.id,
        fingerprint,
      });
      if (check.status === "committed") {
        return replayRecordedReversal(tx, ctx, check.intent);
      }
      if (check.status === "cancelled") {
        return {
          ok: false,
          error: "This attempt was discarded. Start a new operation.",
          conflict: "cancelled",
        };
      }
      if (check.status === "stale_observation") {
        return {
          ok: false,
          error:
            "The document changed since it was checked. Refresh and choose again.",
          conflict: "stale_observation",
        };
      }
      if (check.status !== "prepared") {
        return {
          ok: false,
          error:
            "This reversal attempt changed while it was being recorded. Refresh before retrying.",
          conflict: "already_recorded",
        };
      }
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
    const remaining = toSafePaise(payment.amountPaise - BigInt(reversed));
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
          toSafePaise(invoice.paidPaise - BigInt(input.amountPaise)),
        );
        const total = toSafePaise(invoice.totalPaise);
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
        reversedPaise: toSafePaise(reversed),
      },
      after: {
        reversedPaise: toSafePaise(BigInt(reversed) + BigInt(input.amountPaise)),
        amountPaise: input.amountPaise,
        reason: input.reason,
        invoiceStatus,
        intentId: intent?.id ?? null,
      },
    });

    // Same transaction as the reversal, the invoice update and the
    // audit row. If the marker cannot be written, the transaction rolls
    // back — no effect without its intent.
    if (intent) {
      await markIntentCommitted(tx, {
        tenantId: ctx.tenantId,
        intentId: intent.id,
        resultId: reversal.id,
        actorId,
      });
    }
    return {
      ok: true,
      id: reversal.id,
      invoiceStatus,
      replayed: false,
    };
  });
}

// F01 — a replay returns the recorded reversal and the invoice's
// CURRENT status. It never writes and never mints a new result.
async function replayRecordedReversal(
  tx: TenantTx,
  ctx: ActionCtx,
  intent: PaymentIntent,
): Promise<ReversePaymentResult> {
  if (!intent.resultId) {
    return {
      ok: false,
      error:
        "This reversal was recorded, but its reference could not be read. Check the payment before retrying.",
    };
  }
  const rows = await tx
    .select({
      id: paymentReversals.id,
      paymentId: paymentReversals.paymentId,
    })
    .from(paymentReversals)
    .where(
      and(
        eq(paymentReversals.tenantId, ctx.tenantId),
        eq(paymentReversals.id, intent.resultId),
      ),
    )
    .limit(1);
  const reversal = rows[0];
  if (!reversal) {
    return {
      ok: false,
      error:
        "This reversal was recorded, but its reference could not be read. Check the payment before retrying.",
    };
  }
  const paymentRows = await tx
    .select({ invoiceId: payments.invoiceId })
    .from(payments)
    .where(
      and(
        eq(payments.id, reversal.paymentId),
        eq(payments.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  const invoiceId = paymentRows[0]?.invoiceId;
  let invoiceStatus: InvoiceStatus = "issued";
  if (invoiceId) {
    const invoiceRows = await tx
      .select({ status: invoices.status })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    invoiceStatus =
      (invoiceRows[0]?.status as InvoiceStatus | undefined) ?? "issued";
  }
  return { ok: true, id: reversal.id, invoiceStatus, replayed: true };
}

export type PaymentReversalRow = {
  id: string;
  amountPaise: number;
  reason: string;
  reversedAt: string;
};

export async function listPaymentReversals(
  ctx: ActionCtx,
  paymentId: string,
): Promise<PaymentReversalRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [payment] = await tx.select({ locationId: payments.locationId }).from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.tenantId, ctx.tenantId))).limit(1);
    if (!payment || !locationVisible(await resolveLocationAccess(tx, ctx), payment.locationId)) return [];
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
      amountPaise: toSafePaise(row.amountPaise),
      reason: row.reason,
      reversedAt: row.reversedAt.toISOString(),
    }));
  });
}
