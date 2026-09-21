import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { receipts } from "@/db/schema/receipts";
import { payments } from "@/db/schema/payments";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { auditLog } from "@/db/schema/audit";
import { brandDataFrom } from "@/lib/services/branding";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { renderReceiptPdf } from "@/lib/receipts/receipt-document";
import { gstDocumentKind, placeOfSupplyForGstin } from "@/lib/gst";
import { methodLabel } from "@/lib/services/payments";
import type { PaymentMethod } from "@/db/schema/payments";
import type { AuditSource } from "@/db/schema/audit";
import type { UserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// C-39 — branded receipts. Generated lazily on first read and stored
// against the payment record; the unique (tenant_id, payment_id) makes
// a second read return the stored bytes, never a second document. A
// failed render is an error the caller surfaces — it never blocks the
// payment itself, which is already committed (see recordPayment).

export type ReceiptResult =
  | { ok: true; pdf: Buffer; fileName: string }
  | { ok: false; error: string };

function receiptFileName(invoiceNumber: string): string {
  return `receipt-${invoiceNumber.replace(/[^A-Za-z0-9]+/g, "-")}.pdf`;
}

type ReceiptRow = {
  payment: typeof payments.$inferSelect;
  invoice: typeof invoices.$inferSelect;
  memberName: string;
  locationName: string;
  tenantName: string;
  branding: unknown;
};

type ReceiptActor = {
  userId: UserId | null;
  actorType: "user" | "system";
  source: AuditSource;
  via: string;
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
    .innerJoin(
      members,
      and(eq(members.id, payments.memberId), eq(members.tenantId, tenantId)),
    )
    .innerJoin(persons, eq(persons.id, members.personId))
    .innerJoin(locations, eq(locations.id, payments.locationId))
    .innerJoin(tenants, eq(tenants.id, payments.tenantId))
    .where(and(eq(payments.id, paymentId), eq(payments.tenantId, tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (memberId && row.payment.memberId !== memberId) return null;
  return row;
}

function buildReceiptPdf(row: ReceiptRow, sacCode: string | null): Buffer {
  const brand = brandDataFrom(row.tenantName, row.branding);
  const invoiceTotal = Number(row.invoice.totalPaise);
  const invoicePaid = Number(row.invoice.paidPaise);
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
    memberName: row.memberName,
    paymentAmountPaise: Number(row.payment.amountPaise),
    paymentMethodLabel: methodLabel(row.payment.method as PaymentMethod),
    paymentReference: row.payment.reference,
    paymentReceivedAt: row.payment.receivedAt.toISOString(),
    invoiceSubtotalPaise: Number(row.invoice.subtotalPaise),
    invoiceTaxPaise: Number(row.invoice.taxPaise),
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

  await tx.insert(auditLog).values({
    tenantId,
    actorType: actor.actorType,
    actorId: actor.userId,
    source: actor.source,
    action: "receipt.generate",
    entityType: "receipt",
    entityId: paymentId,
    after: {
      invoiceNumber: row.invoice.invoiceNumber,
      amountPaise: Number(row.payment.amountPaise),
      fileSize: pdf.byteLength,
      via: actor.via,
    },
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
    });
  });
}

// PR2-C11 — member-scoped receipt for the parent token route. The
// caller passes the personId from the verified token, so another
// child's (or another tenant's) payment can never resolve. Generation
// is attributed to the token route (system/api) — no staff user acted.
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
