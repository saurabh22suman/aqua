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

export type BookingBill = {
  bookingId: string;
  facilityName: string;
  subUnitName: string | null;
  startsAt: string;
  endsAt: string;
  memberId: string;
  memberName: string;
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
// inclusive-price equivalent of invoice rounding). The invoice stores
// these two numbers explicitly and snapshots the rate alongside them.
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
  if (!booking.invoiceId || !booking.memberId) {
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

  const totalPaise = Number(invoice.totalPaise);
  const paidPaise = Number(invoice.paidPaise);
  return {
    ok: true,
    alreadyBilled: true,
    bill: {
      bookingId: booking.id,
      facilityName,
      subUnitName,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      memberId: booking.memberId,
      memberName: memberName ?? "",
      documentKind: gstDocumentKind(invoice.gstin),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceStatus: invoice.status as InvoiceStatus,
      lineDescription: line.description,
      pricePaise,
      subtotalPaise: Number(invoice.subtotalPaise),
      taxPaise: Number(invoice.taxPaise),
      totalPaise,
      amountDuePaise: Math.max(0, totalPaise - paidPaise),
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
