import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { invoices, type InvoiceStatus } from "@/db/schema/invoices";
import { locations } from "@/db/schema/locations";
import { writeAudit } from "@/lib/audit/write";
import {
  userLabel,
  userRoleNameFor,
  userNameFor,
} from "@/lib/services/payment-receiver";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { applyPayments } from "@/lib/money/arithmetic";
import { formatINR } from "@/lib/money/format";
import { toSafePaise } from "@/lib/money/safe-paise";
import type { ActionCtx } from "@/lib/auth/context";
import type { PaymentMethod } from "@/db/schema/payments";
import { enqueueMemberNotification } from "@/lib/messaging/notification-enqueue";
import type { PaymentIntent } from "@/db/schema/payment-intents";
import {
  paymentIntentFingerprint,
  lockIntentTarget,
  lockIntentForCommit,
  markIntentCommitted,
  type PaymentIntentConflict,
} from "@/lib/services/payment-intent-core";
import { preparePaymentIntent } from "@/lib/services/payment-intents";

// C-33 — payments recorded at the counter (cash, UPI reference, bank
// transfer). A payment against an invoice updates paid_paise and the
// invoice status in the same transaction; the invoice row is locked
// first so two desks recording at once cannot both win the same
// outstanding balance. Overpayment is refused — the outstanding figure
// is the ceiling, and refunds (V-17) stay a separate, deliberate act.
//
// received_by is the logged-in user id (the desk), same bare shape as
// attendance.marked_by.

export const MAX_PAYMENT_PAISE = 10_000_000_000; // ₹10 crore

const recordPaymentInput = z
  .object({
    invoiceId: z.string().uuid(),
    amountPaise: z.number().int().positive().max(MAX_PAYMENT_PAISE),
    method: z.enum(["cash", "upi", "bank_transfer", "card", "other"]),
    reference: z.string().trim().min(1).max(120).optional(),
    // F01 — the client-minted operation identity. Optional at the
    // service boundary so trusted internal callers/tests keep working;
    // the public action REQUIRES it.
    idempotencyKey: z.string().uuid().optional(),
    // The last committed intent the operator saw in the recovery read.
    // null or omitted = "the read found no committed intent"; both are
    // validated against the chain and fail closed after a newer commit.
    observedIntentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.method === "cash" || (value.reference?.length ?? 0) > 0,
    {
      message: "A non-cash payment needs its reference (UTR / terminal / transaction id).",
      path: ["reference"],
    },
  )
  .refine((value) => value.method !== "cash" || value.reference === undefined, {
    message: "Cash payments do not carry a reference.",
    path: ["reference"],
  });

export type RecordPaymentInput = z.input<typeof recordPaymentInput>;

export type RecordPaymentResult =
  | {
      ok: true;
      id: string;
      // A replay reports the invoice's CURRENT status (issued after a
      // full reversal, void after a void), not the state at recording.
      invoiceStatus: InvoiceStatus;
      replayed: boolean;
    }
  | { ok: false; error: string; conflict?: PaymentIntentConflict };

export type PaymentRow = {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amountPaise: number;
  method: PaymentMethod;
  channel: string;
  reference: string | null;
  status: string;
  receivedAt: string;
  receivedByName: string | null;
  locationName: string;
};

export async function recordPayment(
  ctx: ActionCtx,
  raw: unknown,
): Promise<RecordPaymentResult> {
  const parsed = recordPaymentInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid payment input.",
    };
  }
  const input = parsed.data;
  // Recording money is a counter action; without an actor there is
  // nobody to attribute it to, and the audit row below is mandatory.
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  // F01 — DURABLE IDENTITY BEFORE THE FINANCIAL EFFECT. The prepared
  // row is committed in its own transaction, so a crash or a lost
  // response leaves a durable record to recover on another device.
  // A keyless trusted call keeps the pre-F01 behaviour.
  const fingerprint = paymentIntentFingerprint({
    kind: "payment",
    invoiceId: input.invoiceId,
    amountPaise: input.amountPaise,
    method: input.method,
    reference: input.reference ?? null,
  });
  let intent: PaymentIntent | null = null;
  if (input.idempotencyKey) {
    const prepared = await preparePaymentIntent(ctx, {
      invoiceId: input.invoiceId,
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
    // The same per-target advisory lock as prepare/cancel. It makes the
    // observation re-check below atomic with another commit for this
    // actor + target; different actors/targets do not block.
    if (intent) {
      await lockIntentTarget(tx, {
        tenantId: ctx.tenantId,
        actorId,
        kind: "payment",
        targetId: input.invoiceId,
      });
    }
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, input.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .for("update");
    const invoice = rows[0];
    if (!invoice || !locationVisible(access, invoice.locationId)) {
      return { ok: false, error: "Invoice not found." };
    }

    // F01 — the intent lock comes BEFORE the invoice's status/amount
    // checks, so a late retry replays the recorded payment and reports
    // the invoice's CURRENT status instead of being refused because the
    // invoice has since been paid, reversed or voided. A concurrent
    // retry waits on this lock and then replays the committed result.
    if (intent) {
      const check = await lockIntentForCommit(tx, {
        tenantId: ctx.tenantId,
        intentId: intent.id,
        actorId,
        kind: "payment",
        targetId: invoice.id,
        fingerprint,
      });
      if (check.status === "committed") {
        return replayRecordedPayment(tx, ctx, check.intent);
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
            "This payment attempt changed while it was being recorded. Refresh before retrying.",
          conflict: "already_recorded",
        };
      }
    }

    if (invoice.status === "void") {
      return { ok: false, error: "This invoice is void." };
    }
    if (invoice.status === "paid") {
      return { ok: false, error: "This invoice is already fully paid." };
    }

    const { paid, outstanding } = applyPayments(toSafePaise(invoice.totalPaise), [
      toSafePaise(invoice.paidPaise),
    ]);
    if (outstanding <= 0) {
      return { ok: false, error: "This invoice is already fully paid." };
    }
    if (input.amountPaise > outstanding) {
      return {
        ok: false,
        error: `That is more than the outstanding balance of ${formatINR(outstanding)}.`,
      };
    }
    // K-04 — café counter rule: a café bill settles in full, in one
    // payment. Partial payments are refused in Release 1 (and the
    // overpayment branch above already makes the equality the only
    // passing amount). The member wallet ledger that lifts this
    // constraint is K-05, deliberately out of R1.
    if (invoice.source === "cafe" && input.amountPaise !== outstanding) {
      return {
        ok: false,
        error: `A café bill settles in full — the amount must equal the outstanding balance of ${formatINR(outstanding)}.`,
      };
    }

    const newPaid = paid + input.amountPaise;
    const newStatus = newPaid === toSafePaise(invoice.totalPaise) ? "paid" : "partial";

    // Bug fix (live-attack audit): the same UPI UTR / bank reference
    // cannot justify two different payments. Pre-check here for a
    // clear, actionable error; the partial unique index
    // (payments_tenant_method_reference_uidx) is the backstop against
    // a race between two concurrent recordings with the same
    // reference — see db/migrations/20260915140000_payments_reference_uniqueness.sql.
    if (input.reference) {
      const dupes = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, ctx.tenantId),
            eq(payments.method, input.method),
            eq(payments.reference, input.reference),
          ),
        )
        .limit(1);
      if (dupes.length > 0) {
        return {
          ok: false,
          error: "This reference has already been used for another payment.",
        };
      }
    }

    let payment: { id: string } | undefined;
    try {
      [payment] = await tx
        .insert(payments)
        .values({
          tenantId: ctx.tenantId,
          invoiceId: invoice.id,
          memberId: invoice.memberId,
          locationId: invoice.locationId,
          amountPaise: BigInt(input.amountPaise),
          method: input.method,
          channel: "counter",
          receivedAt: new Date(),
          receivedBy: actorId,
          reference: input.reference ?? null,
          status: "captured",
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: payments.id });
    } catch (err) {
      // Backstop for the race the pre-check above cannot close: two
      // concurrent recordings against different invoices can both
      // pass the pre-check before either commits. The partial unique
      // index (payments_tenant_method_reference_uidx) surfaces as
      // 23505; translate it to the same friendly message rather than
      // a raw Postgres error. Drizzle may wrap the pg error in a
      // higher-level exception — walk the cause chain (same pattern
      // as lib/services/holidays.ts).
      let code: string | undefined = (err as { code?: string }).code;
      let cursor: unknown = err;
      while (!code && cursor && typeof cursor === "object" && "cause" in cursor) {
        cursor = (cursor as { cause: unknown }).cause;
        code = (cursor as { code?: string } | null)?.code;
      }
      if (code === "23505") {
        return {
          ok: false,
          error: "This reference has already been used for another payment.",
        };
      }
      throw err;
    }
    if (!payment) return { ok: false, error: "The payment could not be saved." };

    await tx
      .update(invoices)
      .set({
        paidPaise: BigInt(newPaid),
        status: newStatus,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(invoices.id, invoice.id), eq(invoices.tenantId, ctx.tenantId)),
      );

    // E-01 — the one audit writer, so the actor model (actor_type,
    // source, request_id) is applied in one place: the payment row can
    // be joined to the request that caused it, exactly like the
    // reversal, the void and the wallet rows.
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      action: "payment.record",
      entityType: "payment",
      entityId: payment.id,
      after: {
        invoiceId: invoice.id,
        amountPaise: input.amountPaise,
        method: input.method,
        reference: input.reference ?? null,
        invoiceStatus: newStatus,
        intentId: intent?.id ?? null,
      },
      requestId: ctx.requestId ?? null,
    });

    await enqueueMemberNotification(tx, { tenantId: ctx.tenantId, eventKey: `payment:${payment.id}`, essential: true,
      body: `Aqua payment recorded: ${formatINR(input.amountPaise)} by ${input.method} against invoice ${invoice.invoiceNumber}. Status at recording: ${newStatus}.` }, invoice.memberId);

    // Same transaction as the payment, the invoice update, the audit
    // row and the notification. If this marker cannot be written the
    // whole transaction rolls back — no effect without its intent.
    if (intent) {
      await markIntentCommitted(tx, {
        tenantId: ctx.tenantId,
        intentId: intent.id,
        resultId: payment.id,
        actorId,
      });
    }
    return { ok: true, id: payment.id, invoiceStatus: newStatus, replayed: false };
  });
}

// F01 — a replay returns the operation's own recorded payment and the
// invoice's CURRENT status. It never writes and never mints a new result.
async function replayRecordedPayment(
  tx: TenantTx,
  ctx: ActionCtx,
  intent: PaymentIntent,
): Promise<RecordPaymentResult> {
  if (!intent.resultId) {
    return {
      ok: false,
      error:
        "This payment was recorded, but its reference could not be read. Check the invoice before retrying.",
    };
  }
  const rows = await tx
    .select({ id: payments.id, invoiceId: payments.invoiceId })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, ctx.tenantId),
        eq(payments.id, intent.resultId),
      ),
    )
    .limit(1);
  const payment = rows[0];
  if (!payment?.invoiceId) {
    return {
      ok: false,
      error:
        "This payment was recorded, but its invoice could not be read. Check the invoice before retrying.",
    };
  }
  const invoiceRows = await tx
    .select({ status: invoices.status })
    .from(invoices)
    .where(
      and(
        eq(invoices.id, payment.invoiceId),
        eq(invoices.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  const status = invoiceRows[0]?.status as InvoiceStatus | undefined;
  if (!status) {
    return {
      ok: false,
      error:
        "This payment was recorded, but its invoice could not be read. Check the invoice before retrying.",
    };
  }
  return { ok: true, id: payment.id, invoiceStatus: status, replayed: true };
}

export async function listInvoicePayments(
  ctx: ActionCtx,
  invoiceId: string,
): Promise<PaymentRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const invoiceRows = await tx
      .select({ locationId: invoices.locationId })
      .from(invoices)
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .limit(1);
    const invoice = invoiceRows[0];
    if (!invoice || !locationVisible(access, invoice.locationId)) return [];

    const rows = await tx
      .select({
        payment: payments,
        invoiceNumber: invoices.invoiceNumber,
        locationName: locations.name,
        receiverName: userNameFor(payments.tenantId, payments.receivedBy),
        receiverRole: userRoleNameFor(payments.tenantId, payments.receivedBy),
      })
      .from(payments)
      .leftJoin(
        invoices,
        and(
          eq(invoices.id, payments.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .innerJoin(locations, eq(locations.id, payments.locationId))
      .where(
        and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(desc(payments.receivedAt));

    return rows.map((row) => ({
      id: row.payment.id,
      invoiceId: row.payment.invoiceId,
      invoiceNumber: row.invoiceNumber,
      amountPaise: toSafePaise(row.payment.amountPaise),
      method: row.payment.method as PaymentMethod,
      channel: row.payment.channel,
      reference: row.payment.reference,
      status: row.payment.status,
      receivedAt: row.payment.receivedAt.toISOString(),
      receivedByName: userLabel(row.receiverName, row.receiverRole),
      locationName: row.locationName,
    }));
  });
}

export function methodLabel(method: PaymentMethod): string {
  if (method === "cash") return "Cash";
  if (method === "upi") return "UPI";
  if (method === "card") return "Card";
  if (method === "other") return "Other";
  return "Bank transfer";
}
