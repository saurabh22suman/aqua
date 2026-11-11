import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { receipts } from "@/db/schema/receipts";
import { payments } from "@/db/schema/payments";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import { brandDataFrom } from "@/lib/services/branding";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { renderReceiptPdf } from "@/lib/receipts/receipt-document";
import { gstDocumentKind, placeOfSupplyForGstin } from "@/lib/gst";
import { methodLabel } from "@/lib/services/payments";
import type { PaymentMethod } from "@/db/schema/payments";
import type { AuditSource } from "@/db/schema/audit";
import { asMemberId, type UserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantTx } from "@/db/tenant";
import type { SelfScope } from "@/lib/auth/self-scope";
import { billingSubjectInTx } from "@/lib/services/self-billing";
import { toSafePaise } from "@/lib/money/safe-paise";

// C-39 — branded receipts. Generated lazily on first read and stored
// against the payment record; the unique (tenant_id, payment_id) makes
// a second read return the stored bytes, never a second document. A
// failed render is an error the caller surfaces — it never blocks the
// payment itself, which is already committed (see recordPayment).
//
// WR-1 / Option A — a walk-in payment has no member, so the member
// join is a LEFT join and the receipt names the buyer the invoice
// names. A guest payment that produced NO receipt would be money
// collected with no document behind it, which is exactly the silence
// this change must not create.

export type ReceiptResult =
  | { ok: true; pdf: Buffer; fileName: string }
  | { ok: false; error: string };

function receiptFileName(invoiceNumber: string): string {
  return `receipt-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

type ReceiptRow = {
  payment: typeof payments.$inferSelect;
  invoice: typeof invoices.$inferSelect;
  // WR-1 — the payer's display name: the member's name for a member
  // payer, the invoice's guest name for a guest payer.
  payerName: string;
  locationName: string;
  tenantName: string;
  branding: unknown;
};

type ReceiptActor = {
  userId: UserId | null;
  actorType: "user" | "system";
  source: AuditSource;
  via: string;
  requestId?: string | null;
};

async function loadReceiptRow(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: ActionCtx["tenantId"],
  paymentId: string,
  memberId?: string,
): Promise<ReceiptRow | null> {
  const rows = await tx
    .select({
      payment: payments,
      invoice: invoices,
      memberName: persons.fullName,
      guestName: invoices.guestName,
      locationName: locations.name,
      tenantName: tenants.name,
      branding: tenants.branding,
    })
    .from(payments)
    .innerJoin(
      invoices,
      and(
        eq(invoices.id, payments.invoiceId),
        eq(invoices.tenantId, tenantId),
      ),
    )
    // WR-1 — a guest payment has no member, so this join cannot be an
    // inner join: the receipt must still be produced.
    .leftJoin(
      members,
      and(eq(members.id, payments.memberId), eq(members.tenantId, tenantId)),
    )
    .leftJoin(persons, eq(persons.id, members.personId))
    .innerJoin(locations, eq(locations.id, payments.locationId))
    .innerJoin(tenants, eq(tenants.id, payments.tenantId))
    .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // The member route serves ONE member's receipts. A guest payment has
  // no member, so it is never served there — the parent link can never
  // hand a stranger a walk-in receipt.
  if (memberId && row.payment.memberId !== memberId) return null;
  return {
    payment: row.payment,
    invoice: row.invoice,
    payerName: row.memberName ?? row.guestName ?? "",
    locationName: row.locationName,
    tenantName: row.tenantName,
    branding: row.branding,
  };
}

function buildReceiptPdf(row: ReceiptRow, sacCode: string | null): Buffer {
  const brand = brandDataFrom(row.tenantName, row.branding);
  const invoiceTotal = toSafePaise(row.invoice.totalPaise);
  const invoicePaid = toSafePaise(row.invoice.paidPaise);
  return renderReceiptPdf({
    tenantDisplayName: brand.displayName ?? brand.fallbackDisplayName,
    initials: brand.initials,
    accent: brand.accent,
    documentKind: gstDocumentKind(row.invoice.gstin),
    invoiceNumber: row.invoice.invoiceNumber,
    invoiceIssuedOn: row.invoice.issuedOn,
    gstin: row.invoice.gstin,
    placeOfSupply: placeOfSupplyForGstin(row.invoice.gstin),
    sacCode,
    // The renderer's field carries the PAYER's name: the member's name
    // for a member payer, the guest's name for a walk-in payer. The
    // printed line ("Received with thanks from") is already
    // payer-neutral.
    memberName: row.payerName,
    paymentAmountPaise: toSafePaise(row.payment.amountPaise),
    paymentMethodLabel: methodLabel(row.payment.method as PaymentMethod),
    paymentReference: row.payment.reference,
    paymentReceivedAt: row.payment.receivedAt.toISOString(),
    invoiceSubtotalPaise: toSafePaise(row.invoice.subtotalPaise),
    invoiceTaxPaise: toSafePaise(row.invoice.taxPaise),
    invoiceTotalPaise: invoiceTotal,
    invoicePaidPaise: invoicePaid,
    outstandingPaise: Math.max(0, invoiceTotal - invoicePaid),
  });
}

async function serveOrCreateReceipt(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: ActionCtx["tenantId"],
  paymentId: string,
  row: ReceiptRow,
  actor: ReceiptActor,
): Promise<ReceiptResult> {
  const fileName = receiptFileName(row.invoice.invoiceNumber);
  const existing = await tx
    .select({ pdf: receipts.pdfData })
    .from(receipts)
    .where(
      and(eq(receipts.tenantId, tenantId), eq(receipts.paymentId, paymentId)),
    )
    .limit(1);
  if (existing[0]) {
    return { ok: true, pdf: Buffer.from(existing[0].pdf), fileName };
  }

  const sacRows = await tx
    .select({ sacCode: invoiceLineItems.sacCode })
    .from(invoiceLineItems)
    .where(
      and(
        eq(invoiceLineItems.invoiceId, row.invoice.id),
        eq(invoiceLineItems.tenantId, tenantId),
      ),
    )
    .limit(1);

  const pdf = buildReceiptPdf(row, sacRows[0]?.sacCode ?? null);

  // Race-safe: the second concurrent read generates too, but only one
  // insert lands, and both callers return a real document.
  const inserted = await tx
    .insert(receipts)
    .values({
      tenantId,
      paymentId,
      pdfData: pdf,
      pdfSize: pdf.byteLength,
      createdBy: actor.userId,
    })
    .onConflictDoNothing()
    .returning({ id: receipts.id });
  if (!inserted[0]) {
    const winner = await tx
      .select({ pdf: receipts.pdfData })
      .from(receipts)
      .where(
        and(eq(receipts.tenantId, tenantId), eq(receipts.paymentId, paymentId)),
      )
      .limit(1);
    if (winner[0]) {
      return { ok: true, pdf: Buffer.from(winner[0].pdf), fileName };
    }
    return { ok: false, error: "The receipt could not be generated." };
  }

  await writeAudit(tx, {
    tenantId,
    actorType: actor.actorType,
    actorId: actor.userId,
    source: actor.source,
    action: "receipt.generate",
    entityType: "receipt",
    entityId: paymentId,
    after: {
      invoiceNumber: row.invoice.invoiceNumber,
      amountPaise: toSafePaise(row.payment.amountPaise),
      fileSize: pdf.byteLength,
      via: actor.via,
    },
    requestId: actor.requestId ?? null,
  });

  return { ok: true, pdf, fileName };
}

export async function getOrCreateReceipt(
  ctx: ActionCtx,
  paymentId: string,
): Promise<ReceiptResult> {
  // Generating + storing a receipt writes a row and an audit entry;
  // without an actor there is nobody to attribute it to.
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const row = await loadReceiptRow(tx, ctx.tenantId, paymentId);
    if (!row || !locationVisible(access, row.payment.locationId)) {
      return { ok: false, error: "Receipt not found." };
    }
    return serveOrCreateReceipt(tx, ctx.tenantId, paymentId, row, {
      userId: actorId,
      actorType: "user",
      source: "web",
      via: "staff",
      requestId: ctx.requestId ?? null,
    });
  });
}

// PR2-C11 — member-scoped receipt for the parent token route. The
// caller passes the personId from the verified token, so another
// child's (or another tenant's) payment can never resolve. Generation
// is attributed to the token route (system/api) — no staff user acted.
//
// WR-1 — a walk-in payment has no member, so this route never serves
// one: the member check in loadReceiptRow refuses it.
export async function getReceiptForMember(
  tenantId: ActionCtx["tenantId"],
  memberId: string,
  paymentId: string,
): Promise<ReceiptResult> {
  return withTenant(tenantId, async (tx) => {
    const row = await loadReceiptRow(tx, tenantId, paymentId, memberId);
    if (!row) return { ok: false, error: "Receipt not found." };
    return serveOrCreateReceipt(tx, tenantId, paymentId, row, {
      userId: null,
      actorType: "system",
      source: "api",
      via: "parent_link",
    });
  });
}

// Scoped self-session receipt: eligibility and creation share the caller's
// transaction. The subject is revalidated before any receipt read/write.
export async function getScopedSelfReceiptInTx(tx: TenantTx, scope: SelfScope, paymentId: string, selected?: string): Promise<ReceiptResult> {
  const memberId = await billingSubjectInTx(tx, scope, selected);
  if (!memberId) return { ok: false, error: "Receipt not found." };
  // Lock payment before invoice, matching the existing reversal service.
  // Recheck the captured status and member/invoice relation while locked.
  const [payment] = await tx.select({ invoiceId: payments.invoiceId }).from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.tenantId, scope.tenantId), eq(payments.memberId, asMemberId(memberId)), eq(payments.status, "captured"))).limit(1).for("share");
  if (!payment?.invoiceId) return { ok: false, error: "Receipt not found." };
  const [invoice] = await tx.select({ id: invoices.id }).from(invoices)
    .where(and(eq(invoices.id, payment.invoiceId), eq(invoices.tenantId, scope.tenantId), eq(invoices.memberId, asMemberId(memberId)))).limit(1).for("share");
  if (!invoice) return { ok: false, error: "Receipt not found." };
  const row = await loadReceiptRow(tx, scope.tenantId, paymentId, memberId);
  if (!row) return { ok: false, error: "Receipt not found." };
  const via = scope.audience === "member" ? "member_self" : "guardian_self";
  const result = await serveOrCreateReceipt(tx, scope.tenantId, paymentId, row, {
    userId: scope.userId, actorType: "user", source: "api", via,
  });
  if (!result.ok) return result;
  await writeAudit(tx, {
    tenantId: scope.tenantId, actorType: "user", actorId: scope.userId,
    source: "api", action: "receipt.download", entityType: "receipt", entityId: paymentId,
    after: { via, fileSize: result.pdf.byteLength },
  });
  return result;
}
