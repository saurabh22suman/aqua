import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { invoices } from "@/db/schema/invoices";
import { locations } from "@/db/schema/locations";
import { auditLog } from "@/db/schema/audit";
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
import type { ActionCtx } from "@/lib/auth/context";
import type { PaymentMethod } from "@/db/schema/payments";

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
  | { ok: true; id: string; invoiceStatus: "partial" | "paid" }
  | { ok: false; error: string };

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

  return withTenant(ctx.tenantId, async (tx) => {
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
    if (invoice.status === "void") {
      return { ok: false, error: "This invoice is void." };
    }
    if (invoice.status === "paid") {
      return { ok: false, error: "This invoice is already fully paid." };
    }

    const { paid, outstanding } = applyPayments(Number(invoice.totalPaise), [
      Number(invoice.paidPaise),
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
    const newStatus = newPaid === Number(invoice.totalPaise) ? "paid" : "partial";

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

    await tx.insert(auditLog).values({
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
      },
    });

    return { ok: true, id: payment.id, invoiceStatus: newStatus };
  });
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
      amountPaise: Number(row.payment.amountPaise),
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
