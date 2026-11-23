import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { invoices } from "@/db/schema/invoices";
import { bookingCheckIns } from "@/db/schema/booking-check-ins";
import { facilities } from "@/db/schema/preset-engine";
import { toSafePaise } from "@/lib/money/safe-paise";
import { ENTRY_WINDOW_LEAD_MINUTES } from "@/lib/services/booking-entry";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { BookingEntryPassFacts } from "@/components/bookings/booking-entry-shared";

// THE AUTHORITATIVE PASS VIEW IS A READ, NOT A BILL INFERENCE.
//
// A settled invoice proves none of the three facts a receipt must not invent:
//
//   * the booking is `confirmed` — `bookings.status` is not on `BookingBill`;
//   * the caller may mint — `bookings.read` is not a bill fact;
//   * no check-in exists — that is a row in `booking_check_ins`.
//
// This service reads all three under the SAME boundaries the entry service
// already uses: `withTenant()` plus the O-08 location mechanism. It returns
// facts only. It does not decide the caller's permission (the action does, with
// `requirePermission`), it does not map display state, and it never creates a
// token or writes a row.
//
// v3 corrections:
//   * `invoiceId` is returned so the receipt can refuse a view for a replaced
//     document;
//   * facility and invoice reads are also location-filtered, not just the
//     booking and check-in row;
//   * bigint → number uses `toSafePaise`; an amount outside the exact integer
//     range makes the read fail closed instead of entering the mapper with a
//     rounded value;
//   * `entryWindow` is computed from persisted instants and the server clock,
//     using the same 30-minute lead the scan service owns. It is display
//     truth only; the scan remains the admission authority.
//
// WHY NOT REUSE `readBookingEntry()`: that helper returns null for both "no
// check-in row" and "a row this caller cannot see". The pass view must treat
// the second as unavailable, never as `checkedInAt: null`. Reading the row in
// this same transaction lets us distinguish the two and fail closed.
//
// FAIL CLOSED: a booking that is missing, in another tenant or outside the
// caller's location returns null. A linked invoice or facility outside the
// caller's location returns null. An unreadable linked invoice returns null
// rather than pretending the booking is unbilled. So does an amount that
// cannot be converted exactly. The caller renders "availability could not be
// checked".
//
// SNAPSHOT, NOT A SUBSCRIPTION: no row lock is taken. A concurrent status,
// money or check-in change can make this view stale; the mint and scan actions
// re-check under their own locks. A stale view can offer a control; it cannot
// admit a guest.

const bookingIdInput = z.string().uuid();
const ENTRY_WINDOW_LEAD_MS = ENTRY_WINDOW_LEAD_MINUTES * 60_000;

/**
 * Read one booking's pass facts.
 *
 * No row lock is taken. This is a display read; the mint and scan actions are
 * the atomic gates and recheck status, window, money and replay.
 */
export async function readBookingEntryPassFacts(
  ctx: ActionCtx,
  bookingId: string,
): Promise<BookingEntryPassFacts | null> {
  const parsed = bookingIdInput.safeParse(bookingId);
  if (!parsed.success) return null;
  if (!ctx.userId) return null;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);

    const bookingRows = await tx
      .select({
        id: bookings.id,
        facilityId: bookings.facilityId,
        locationId: bookings.locationId,
        status: bookings.status,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        invoiceId: bookings.invoiceId,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, parsed.data),
          eq(bookings.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const booking = bookingRows[0];
    // The booking itself is the first boundary. An out-of-location booking is
    // "not found" to this caller, exactly as it is to mint/scan.
    if (!booking || !locationVisible(access, booking.locationId)) return null;

    const facilityRows = await tx
      .select({
        name: facilities.name,
        locationId: facilities.locationId,
      })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, booking.facilityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const facility = facilityRows[0];
    // The facility is normally at the booking's location, but the invariant is
    // not a database constraint. Re-check it rather than describing the read as
    // location-scoped when only the booking was checked.
    if (!facility || !locationVisible(access, facility.locationId)) return null;

    let invoiceId: string | null = null;
    let invoiceStatus = "none";
    let paidPaise = 0;
    let totalPaise = 0;
    if (booking.invoiceId) {
      const invoiceRows = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          paidPaise: invoices.paidPaise,
          totalPaise: invoices.totalPaise,
          locationId: invoices.locationId,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, booking.invoiceId),
            eq(invoices.tenantId, ctx.tenantId),
          ),
        )
        .limit(1);
      const invoice = invoiceRows[0];
      // The booking points at a document the foreign key says exists. If it
      // cannot be read under this tenant/location, do not guess a payment
      // state.
      if (!invoice || !locationVisible(access, invoice.locationId)) return null;
      try {
        paidPaise = toSafePaise(invoice.paidPaise);
        totalPaise = toSafePaise(invoice.totalPaise);
      } catch {
        // Outside Number.MAX_SAFE_INTEGER: a rounded comparison could
        // misclassify paid/partial. Fail closed; do not fabricate a view.
        return null;
      }
      invoiceId = invoice.id;
      invoiceStatus = invoice.status;
    }

    const checkInRows = await tx
      .select({
        checkedInAt: bookingCheckIns.checkedInAt,
        locationId: bookingCheckIns.locationId,
      })
      .from(bookingCheckIns)
      .where(
        and(
          eq(bookingCheckIns.tenantId, ctx.tenantId),
          eq(bookingCheckIns.bookingId, booking.id),
        ),
      )
      .limit(1);
    const checkIn = checkInRows[0];
    // The table's RLS is tenant-only; location is a service rule. Repeat the
    // existing visibility check on the recorded row rather than describe this
    // as database-enforced location isolation.
    if (checkIn && !locationVisible(access, checkIn.locationId)) return null;

    const opensAt = new Date(
      booking.startsAt.getTime() - ENTRY_WINDOW_LEAD_MS,
    );
    const closesAt = booking.endsAt;
    const nowMs = Date.now();
    const entryWindowState =
      nowMs < opensAt.getTime()
        ? ("too_early" as const)
        : nowMs < closesAt.getTime()
          ? ("open" as const)
          : ("closed" as const);

    return {
      bookingId: booking.id,
      invoiceId,
      facilityName: facility.name,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      bookingStatus: booking.status,
      invoiceStatus,
      paidPaise,
      totalPaise,
      checkedInAt: checkIn ? checkIn.checkedInAt.toISOString() : null,
      entryWindow: {
        state: entryWindowState,
        opensAt: opensAt.toISOString(),
        closesAt: closesAt.toISOString(),
      },
    };
  });
}
