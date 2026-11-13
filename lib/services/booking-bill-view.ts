import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { facilities, facilitySubUnits } from "@/db/schema/preset-engine";
import { members, persons } from "@/db/schema/people";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { gstDocumentKind, type GstDocumentKind } from "@/lib/gst";
import { splitTotal } from "@/lib/money/arithmetic";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { InvoiceStatus } from "@/db/schema/invoices";
import type { InvoicePayerKind } from "@/db/schema/invoices";

// FINAL DECISION (2026-11-05, completion pass): WR-9 is now DECIDED for this
// release. An already-paid invoice is kept AS ISSUED and paid buyer/name
// corrections are DEFERRED. The comments below that still call WR-9 "not
// defined" are historical context; the authoritative note is
// docs/design/parallel-release/walk-in-approval/completion-20261105/README.md.
//
// V-04 — the booking bill read side and the inclusive-price split,
// split out of lib/services/booking-billing.ts for the 300-line rule
// (mirroring cafe-bill-view.ts vs cafe-billing.ts). booking-billing
// re-exports this surface.
//
// The booking price is GST-inclusive: the quoted price is the price
// the customer pays (a court advertised at ₹500 collects ₹500). The
// invoice needs a taxable base and a tax such that base + tax is
// exactly the price. `splitTotal` divides the inclusive total; the
// request passes the resulting base/tax as an explicit snapshot
// (invoice-issue accepts taxPaise) because its default recompute can
// differ by one paisa of rounding.
//
// WR-1 / Option A — the bill's payer is the DOCUMENT's payer. A guest
// bill has no member and carries the buyer's name, so the bill shows
// that name and the counter can read who is being charged.
//
// DECISION (2026-11-05) — the identity of an ISSUED document is fixed:
// a wrongly-billed walk-in invoice, and a typo in its guest name, are
// corrected by VOIDING AND REISSUING, never by editing the issued
// document. Two things follow for this read side:
//
//   * a VOID document is not collectible, so its amount due is ZERO
//     (buildBill below). A voided bill that still showed an amount due
//     would invite the counter to collect money the product will
//     refuse ("This invoice is void." — lib/services/payments.ts);
//   * the invoice a booking points at is READABLE, so the write side
//     can tell "already billed" from "voided, and therefore
//     replaceable" (loadLinkedInvoice below).
//
// WR-12 PASS (2026-11-05) — loadLinkedInvoice also carries the linked
// document's BUYER NAME. The write side needs it for two things, and
// both are about honesty rather than about the money:
//
//   * a corrected name may only be applied to a VOID document, so the
//     write side must be able to say "this bill is live and names
//     somebody else" instead of dropping the correction;
//   * the voided document's name goes into the replacement's audit row
//     as `before.guestName`, so the from→to of a correction is legible
//     in one row.
//
// The read is a plain column read of the same row the write side
// already reads; no new table, no new join, no new query.

export type BookingBill = {
  bookingId: string;
  facilityName: string;
  subUnitName: string | null;
  startsAt: string;
  endsAt: string;
  // WR-1 — a guest bill has no member.
  memberId: string | null;
  memberName: string | null;
  // Which kind of payer this bill names, and the name to show.
  payerKind: InvoicePayerKind;
  payerName: string;
  documentKind: GstDocumentKind;
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: InvoiceStatus;
  lineDescription: string;
  pricePaise: number;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  amountDuePaise: number;
};

export type BookingBillResult =
  | { ok: true; bill: BookingBill; alreadyBilled: boolean }
  | { ok: false; error: string };

// The GST-inclusive split: base = round(price × 10000 / (10000 +
// rate)), tax = price − base, so base + tax === price by construction
// for every price and rate. The tax is the remainder rather than a
// re-derived computeTax(base, rate), which differs from it by at most
// one paisa when the rounding of the two paths disagrees (the
// inclusive-price equivalent of invoice rounding).
export function splitInclusivePrice(
  pricePaise: number,
  rateBp: number,
): { base: number; tax: number } {
  const base = splitTotal(pricePaise, rateBp).base;
  return { base, tax: pricePaise - base };
}

export type BookingRow = typeof bookings.$inferSelect;
export type BookingContext = {
  booking: BookingRow;
  facilityName: string;
  subUnitName: string | null;
  memberName: string | null;
};

/**
 * The invoice a booking points at, read inside the caller's transaction.
 *
 * The booking carries the ONLY link to its document (bookings.invoice_id
 * — there is no invoices.booking_id column), so this read is how the
 * write side tells three states apart:
 *
 *   * no invoice at all — the booking has never been billed;
 *   * an invoice that is not void — already billed, still collectible;
 *   * a VOID invoice — the document was voided, which is how the
 *     product corrects a wrongly-billed or misspelled document, so the
 *     booking may be issued a REPLACEMENT.
 *
 * `paidPaise` comes along because a void document with money on it must
 * never be replaced silently: voidInvoice refuses to void a document
 * that has money recorded against it, so such a document should not
 * exist — and if one ever did, the correction path for it is NOT
 * defined (WR-9).
 *
 * `guestName` comes along for WR-12: the corrected buyer's name may
 * only be applied to a void document, and the voided document's own
 * name is what the replacement's audit row names as `before.guestName`.
 */
export type LinkedInvoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  paidPaise: number;
  /** The buyer's name this document names (null for a member payer). */
  guestName: string | null;
};

export async function loadLinkedInvoice(
  tx: TenantTx,
  ctx: ActionCtx,
  booking: BookingRow,
): Promise<LinkedInvoice | null> {
  if (!booking.invoiceId) return null;
  const [invoice] = await tx
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      status: invoices.status,
      paidPaise: invoices.paidPaise,
      guestName: invoices.guestName,
    })
    .from(invoices)
    .where(
      and(eq(invoices.id, booking.invoiceId), eq(invoices.tenantId, ctx.tenantId)),
    )
    .limit(1);
  if (!invoice) return null;
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    paidPaise: Number(invoice.paidPaise),
    guestName: invoice.guestName ?? null,
  };
}

// Internal to the billing slice (requestBookingBill and
// readBookingBill); exported across the two files only.
export async function loadBooking(
  tx: TenantTx,
  ctx: ActionCtx,
  bookingId: string,
  options: { forUpdate?: boolean } = {},
): Promise<BookingContext | null> {
  // Lock the bookings row alone: Postgres refuses FOR UPDATE on the
  // nullable side of an outer join, and the display names are only
  // needed after the lock is held. One invoice per booking is
  // guaranteed by serialising on this row, not by a unique index.
  const locked = options.forUpdate
    ? await tx
        .select()
        .from(bookings)
        .where(
          and(eq(bookings.id, bookingId), eq(bookings.tenantId, ctx.tenantId)),
        )
        .limit(1)
        .for("update")
    : await tx
        .select()
        .from(bookings)
        .where(
          and(eq(bookings.id, bookingId), eq(bookings.tenantId, ctx.tenantId)),
        )
        .limit(1);
  const booking = locked[0];
  if (!booking) return null;

  const access = await resolveLocationAccess(tx, ctx);
  if (!locationVisible(access, booking.locationId)) return null;

  const names = await tx
    .select({
      facilityName: facilities.name,
      subUnitName: facilitySubUnits.name,
      memberName: persons.fullName,
    })
    .from(facilities)
    .leftJoin(
      facilitySubUnits,
      sql`${facilitySubUnits.id} = ${booking.subUnitId} and ${facilitySubUnits.tenantId} = ${ctx.tenantId}`,
    )
    .leftJoin(
      members,
      sql`${members.id} = ${booking.memberId} and ${members.tenantId} = ${ctx.tenantId}`,
    )
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(
      and(
        eq(facilities.id, booking.facilityId),
        eq(facilities.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  const name = names[0];
  if (!name) return null;
  return {
    booking,
    facilityName: name.facilityName,
    subUnitName: name.subUnitName,
    memberName: name.memberName,
  };
}

export async function buildBill(
  tx: TenantTx,
  ctx: ActionCtx,
  booking: BookingRow,
  facilityName: string,
  subUnitName: string | null,
  memberName: string | null,
): Promise<BookingBillResult> {
  if (!booking.invoiceId) {
    return { ok: false, error: "This booking has no bill yet." };
  }
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.id, booking.invoiceId),
        eq(invoices.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);
  if (!invoice) return { ok: false, error: "This booking has no bill yet." };

  const lines = await tx
    .select()
    .from(invoiceLineItems)
    .where(
      and(
        eq(invoiceLineItems.invoiceId, invoice.id),
        eq(invoiceLineItems.tenantId, ctx.tenantId),
      ),
    );
  const line = lines[0];
  if (!line) return { ok: false, error: "This booking has no bill yet." };

  const pricePaise = Number(booking.pricePaise);
  if (Number(invoice.totalPaise) !== pricePaise) {
    // The booking snapshotted the price and the invoice was issued
    // from it; a drift means one of the two was edited out of band.
    // Render nothing rather than a wrong amount due.
    return { ok: false, error: "The booking and its bill disagree." };
  }

  // WR-1 — the payer comes from the invoice, not from the booking: the
  // document is what the customer is billed to. A guest invoice has no
  // member and names the buyer itself; a member invoice names the
  // member, and the member's own record is the authority for that
  // name (the booking's name is only a fallback).
  //
  // WR-12 — this is also where a CORRECTED name shows up: the bill
  // panel reads the DOCUMENT's name, so after a void-and-reissue the
  // counter sees the corrected buyer on the replacement, not the name
  // the desk wrote on the booking.
  const payerKind = invoice.payerKind as InvoicePayerKind;
  const invoiceMemberId = invoice.memberId;
  let payerName = invoice.guestName ?? "";
  let billMemberName: string | null = null;
  if (payerKind === "member") {
    payerName = memberName ?? "";
    billMemberName = memberName;
    if (invoiceMemberId) {
      const memberRows = await tx
        .select({ fullName: persons.fullName })
        .from(members)
        .innerJoin(persons, eq(persons.id, members.personId))
        .where(
          and(
            eq(members.id, invoiceMemberId),
            eq(members.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      if (memberRows[0]) {
        payerName = memberRows[0].fullName;
        billMemberName = memberRows[0].fullName;
      }
    }
  }

  const totalPaise = Number(invoice.totalPaise);
  const paidPaise = Number(invoice.paidPaise);
  // DECISION (2026-11-05) — a VOID document is not collectible. The
  // amount due of a voided bill is zero, whatever it says on the
  // face: the product refuses a payment against it ("This invoice is
  // void." — lib/services/payments.ts), and a bill panel that still
  // showed an amount due would invite the counter to try.
  const voided = invoice.status === "void";
  return {
    ok: true,
    alreadyBilled: true,
    bill: {
      bookingId: booking.id,
      facilityName,
      subUnitName,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      memberId: invoiceMemberId,
      memberName: billMemberName,
      payerKind,
      payerName,
      documentKind: gstDocumentKind(invoice.gstin),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceStatus: invoice.status as InvoiceStatus,
      lineDescription: line.description,
      pricePaise,
      subtotalPaise: Number(invoice.subtotalPaise),
      taxPaise: Number(invoice.taxPaise),
      totalPaise,
      amountDuePaise: voided ? 0 : Math.max(0, totalPaise - paidPaise),
    },
  };
}

export async function readBookingBill(
  ctx: ActionCtx,
  bookingId: string,
): Promise<BookingBillResult> {
  const parsed = z.string().uuid().safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };

  return withTenant(ctx.tenantId, async (tx) => {
    const context = await loadBooking(tx, ctx, parsed.data);
    if (!context) return { ok: false, error: "Booking not found." };
    return buildBill(
      tx,
      ctx,
      context.booking,
      context.facilityName,
      context.subUnitName,
      context.memberName,
    );
  });
}
