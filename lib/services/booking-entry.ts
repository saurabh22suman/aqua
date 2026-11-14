import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { invoices } from "@/db/schema/invoices";
import { bookingCheckIns } from "@/db/schema/booking-check-ins";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  signBookingEntryToken,
  verifyBookingEntryToken,
} from "@/lib/services/booking-entry-token";
import type { ActionCtx } from "@/lib/auth/context";

// The paid-booking entry lane.
//
// An ARRIVAL, not a payment. The scan records that a guest came; the money
// was collected by hand at the counter through the existing recordPayment
// path, and this file never writes a payments row, an invoice amount or a
// payment audit row.
//
// Four boundaries are enforced here and nowhere else:
//   * the TENANT boundary — the pass names a tenant, and the read happens
//     under withTenant() with FORCE RLS;
//   * the LOCATION boundary — the existing O-08 mechanism, resolved from the
//     database;
//   * the STATE boundary — only a `confirmed` booking is admissible. A
//     cancelled booking is named `cancelled`; held, completed and any future
//     non-confirmed status are refused `not_confirmed`, never admitted just
//     because the money and time happen to fit;
//   * the TIME boundary — the booking's persisted [starts_at - 30 minutes,
//     ends_at) window, on the server clock, under the booking row lock.
//
// The check order is part of the contract: visibility is decided BEFORE
// state, state BEFORE time, and time BEFORE money, so a caller who may not
// see a booking never learns that it exists, an out-of-window scan is
// refused before the invoice lock is taken, and a non-confirmed booking is
// judged by what it is, not by a payment or clock accident. Cancellation is
// named specifically because it is the definitive state; every other
// non-confirmed status fails closed to `not_confirmed`.
//
// The scan takes TWO row locks, in the house order: the booking first, then
// the invoice. requestBookingBill takes the same two in the same order, and
// no path in the codebase locks an invoice and then a booking. The invoice
// lock is what makes a concurrent reversal and a scan serialisable. The
// conflict-safe insert on the named unique constraint is what makes
// simultaneous scans produce exactly one entry without aborting a
// transaction.
//
// MINT IS NOT THE ADMISSION GATE. Mint checks the booking's eligibility so
// the server does not rely on the UI, but the scan re-checks confirmation,
// cancellation, the window and the money atomically under the locks. A
// booking that is paid at mint and reversed before the scan is still refused,
// and a booking that is held or completed never becomes admissible merely
// because its invoice is settled.

export const BOOKING_ENTRY_AUDIT_ACTION = "booking.check_in";

/**
 * The human decision of 2026-11-06: a pass is accepted from 30 minutes
 * BEFORE the booking starts until the booking ends.
 */
export const ENTRY_WINDOW_LEAD_MINUTES = 30;
const ENTRY_WINDOW_LEAD_MS = ENTRY_WINDOW_LEAD_MINUTES * 60_000;

/**
 * One generic sentence for every mint ineligibility (not confirmed — held,
 * completed or cancelled — unpaid, partly paid, already ended). The pass is
 * a UI convenience; the caller is already looking at the booking, so the
 * mint refusal need not enumerate the booking's state.
 */
const INELIGIBLE_PASS_TEXT = "This booking cannot have an entry pass.";

const checkInInput = z.object({ token: z.string().min(1).max(4096) });
const bookingIdInput = z.string().uuid();

export type BookingEntry = {
  bookingId: string;
  checkedInAt: string;
  checkedInBy: string | null;
  method: "qr";
};

export type BookingEntryReason =
  | "invalid_token"
  | "not_found"
  | "not_paid"
  | "already_checked_in"
  | "cancelled"
  | "not_confirmed"
  | "not_in_window"
  | "not_authenticated";

export type CheckInBookingResult =
  | { ok: true; entry: BookingEntry }
  | { ok: false; error: string; reason: BookingEntryReason };

export type MintEntryTokenResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string };

const REFUSAL_TEXT: Record<BookingEntryReason, string> = {
  invalid_token: "That pass is not valid.",
  not_found: "Booking not found.",
  not_paid: "Collect the payment before admitting this guest.",
  already_checked_in: "This guest is already checked in. Ask a staff member.",
  cancelled: "This booking was cancelled.",
  not_confirmed: "This booking is not confirmed for entry.",
  not_in_window: "That pass cannot be used for this booking right now.",
  not_authenticated: "Not authenticated.",
};

function refuse(reason: BookingEntryReason): CheckInBookingResult {
  return { ok: false, error: REFUSAL_TEXT[reason], reason };
}

type BookingTiming = { startsAt: Date; endsAt: Date };

/**
 * The admission window is the half-open interval [opens_at, ends_at):
 *
 *   opens_at = starts_at - 30 minutes   (INCLUSIVE)
 *   ends_at  = the booking's end        (EXCLUSIVE)
 *
 * Both values come from the booking's persisted timestamptz columns and are
 * compared as epoch milliseconds. There is no tenant-timezone conversion, no
 * local-day arithmetic, no DST rule and no client-supplied time: the same
 * instant is the same boundary on every server. `nowMs` is read after the
 * booking row lock is held, so a scan that waited behind a writer is judged
 * at the instant it actually holds the booking.
 */
function isInsideEntryWindow(booking: BookingTiming, nowMs: number): boolean {
  const opensAtMs = booking.startsAt.getTime() - ENTRY_WINDOW_LEAD_MS;
  return nowMs >= opensAtMs && nowMs < booking.endsAt.getTime();
}

/**
 * The pass expires at the booking's end, not at a fixed 24 hours after mint.
 *
 * `exp` is whole seconds. Rounding the end UP keeps the pass valid through
 * the last millisecond before the booking ends. Verification refuses
 * `exp <= now`, so at the end instant the pass is already invalid, exactly
 * matching the end-exclusive admission window. A booking next month gets a
 * pass that is good until that booking ends; a booking in an hour does not
 * get a spurious 24-hour tail.
 *
 * The subtraction uses `floor(now)` because the signer also floors `now`.
 * If the clock rolls to the next second between this calculation and the
 * signature, the token can outlive the end by less than one second; the scan
 * still refuses at the end because it checks the persisted instant again
 * under the lock.
 */
function passTtlSeconds(endsAt: Date, nowMs: number): number {
  return Math.ceil(endsAt.getTime() / 1000) - Math.floor(nowMs / 1000);
}

// Minting a pass READS the booking and signs a claim. It writes nothing, so
// it writes no audit row — the issuance trail is not part of this release.
//
// Eligibility is checked HERE as well as at the scan. The UI promises a pass
// only for an eligible booking, but the server does not trust the UI: a
// non-confirmed (held/completed/cancelled), unpaid, partly paid or
// already-ended booking is refused here.
//
// The WINDOW itself is deliberately NOT enforced at mint. A legitimate
// booking next week may be issued its pass now; the 30-minute opening is
// applied at the scan. The pass TTL is tied to the booking's end, so it does
// not expire before the booking starts.
export async function mintBookingEntryToken(
  ctx: ActionCtx,
  bookingId: string,
): Promise<MintEntryTokenResult> {
  const parsed = bookingIdInput.safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({
        id: bookings.id,
        locationId: bookings.locationId,
        status: bookings.status,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        invoiceId: bookings.invoiceId,
      })
      .from(bookings)
      .where(
        and(eq(bookings.id, parsed.data), eq(bookings.tenantId, ctx.tenantId)),
      )
      .limit(1);
    const booking = rows[0];
    if (!booking || !locationVisible(access, booking.locationId)) {
      return { ok: false, error: "Booking not found." };
    }

    // The same eligibility the scan will re-check. FAIL CLOSED: only a
    // `confirmed` booking may be issued a pass. A held, completed, cancelled
    // or future unknown status is refused here even when it is fully paid
    // and inside the booking's time. Checking `!== "confirmed"` (rather than
    // enumerating the bad states) means a new status cannot silently become
    // admissible.
    if (booking.status !== "confirmed") {
      return { ok: false, error: INELIGIBLE_PASS_TEXT };
    }
    const nowMs = Date.now();
    if (nowMs >= booking.endsAt.getTime()) {
      return { ok: false, error: INELIGIBLE_PASS_TEXT };
    }

    // R1 — the booking's bill must exist and be FULLY paid at mint. This is
    // a read, not a lock: the scan is the atomic gate. A concurrent reversal
    // after this read is caught by the scan's invoice lock.
    if (!booking.invoiceId) {
      return { ok: false, error: INELIGIBLE_PASS_TEXT };
    }
    const invoiceRows = await tx
      .select({
        status: invoices.status,
        paidPaise: invoices.paidPaise,
        totalPaise: invoices.totalPaise,
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
    if (
      !invoice ||
      invoice.status !== "paid" ||
      invoice.paidPaise !== invoice.totalPaise
    ) {
      return { ok: false, error: INELIGIBLE_PASS_TEXT };
    }

    // Read the clock again after the eligibility reads: a slow query must not
    // buy the pass extra time past the booking's end.
    const ttlSeconds = passTtlSeconds(booking.endsAt, Date.now());
    if (ttlSeconds <= 0) {
      return { ok: false, error: INELIGIBLE_PASS_TEXT };
    }

    const signed = signBookingEntryToken({
      tenantId: ctx.tenantId,
      bookingId: booking.id,
      ttlSeconds,
    });
    return {
      ok: true,
      token: signed.token,
      expiresAt: new Date(signed.claims.exp * 1000).toISOString(),
    };
  });
}

export async function checkInBooking(
  ctx: ActionCtx,
  raw: unknown,
): Promise<CheckInBookingResult> {
  const parsed = checkInInput.safeParse(raw);
  if (!parsed.success) return refuse("invalid_token");
  if (!ctx.userId) return refuse("not_authenticated");
  const actorId = ctx.userId;

  const claims = verifyBookingEntryToken(parsed.data.token);
  if (!claims) return refuse("invalid_token");
  // A pass from another tenant is "not found", never "invalid": the scan must
  // not tell a stranger that a booking id exists somewhere else.
  if (claims.tenantId !== ctx.tenantId) return refuse("not_found");

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    // The booking row lock serialises two simultaneous scans of the same
    // booking; the unique constraint on booking_check_ins is the backstop.
    const bookingRows = await tx
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.id, claims.bookingId),
          eq(bookings.tenantId, ctx.tenantId),
        ),
      )
      .for("update");
    const booking = bookingRows[0];
    if (!booking || !locationVisible(access, booking.locationId)) {
      return refuse("not_found");
    }
    if (booking.status === "cancelled") return refuse("cancelled");
    // STATE — only a confirmed booking is admissible. `held` is a hold, not
    // an admission; `completed` has already happened; any future status is
    // unknown. None of them may be admitted merely because the invoice is
    // paid and the clock is inside the booking window, so this check is
    // deliberately before TIME and MONEY. `!== "confirmed"` is fail-closed.
    if (booking.status !== "confirmed") return refuse("not_confirmed");

    // TIME — the human's window, [starts_at - 30 minutes, ends_at). Read the
    // clock AFTER the row lock: a scan that waited for a concurrent writer
    // must be judged at the instant it holds the booking, not when it entered
    // the transaction. The booking's persisted instants are the only inputs;
    // the token's expiry is a second, independent gate, not the authority.
    const nowMs = Date.now();
    if (!isInsideEntryWindow(booking, nowMs)) {
      return refuse("not_in_window");
    }

    // R1 — the money READ, UNDER THE INVOICE ROW LOCK. Never a write: the
    // scan moves no money.
    //
    // The LOCK ORDER is booking -> invoice, and it is part of the contract.
    // requestBookingBill takes the same two locks in the same order
    // (loadBooking(..., { forUpdate: true }) and then the invoice work), and
    // no path in the codebase locks an invoice and then a booking. Taking
    // the invoice lock BEFORE the booking would invert that order and
    // deadlock against a bill being issued for the same booking.
    //
    // Why the lock at all: without it the money predicate reads a committed
    // snapshot that a concurrent reversal can invalidate between the read and
    // the commit, so a guest can be admitted against an invoice that was
    // reversed a moment earlier. With the lock the admission and the reversal
    // are SERIALISED: either the reversal commits first and this scan reads
    // the reversed invoice (refused `not_paid`), or this scan holds the lock
    // and the reversal waits for it.
    if (!booking.invoiceId) return refuse("not_paid");
    const invoiceRows = await tx
      .select({
        status: invoices.status,
        paidPaise: invoices.paidPaise,
        totalPaise: invoices.totalPaise,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, booking.invoiceId),
          eq(invoices.tenantId, ctx.tenantId),
        ),
      )
      .limit(1)
      .for("update");
    const invoice = invoiceRows[0];
    if (
      !invoice ||
      invoice.status !== "paid" ||
      invoice.paidPaise !== invoice.totalPaise
    ) {
      return refuse("not_paid");
    }

    // A fast path, not the guarantee: if an entry is already there, the scan
    // is a replay. The GUARANTEE is the unique constraint, enforced by the
    // conflict-safe insert below.
    const existing = await tx
      .select({ id: bookingCheckIns.id })
      .from(bookingCheckIns)
      .where(
        and(
          eq(bookingCheckIns.tenantId, ctx.tenantId),
          eq(bookingCheckIns.bookingId, booking.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) return refuse("already_checked_in");

    // FINAL TIME RE-CHECK. The booking lock has been held since the first
    // check, but the invoice lock wait can cross the end boundary. Re-read the
    // clock immediately before the write so a slow lock can never turn a
    // just-in-time scan into an admission after the booking ended. Replays
    // were already answered above, so this cannot mask `already_checked_in`.
    if (!isInsideEntryWindow(booking, Date.now())) {
      return refuse("not_in_window");
    }

    // CONFLICT-SAFE INSERT. No exception is raised, so the transaction stays
    // usable; the target is the ONE unique constraint that means "this
    // booking is already admitted"; and "no row came back" is the refusal.
    // A uuidv7 collision on the (id, tenant_id) constraint is NOT reported as
    // "already checked in".
    const [entry] = await tx
      .insert(bookingCheckIns)
      .values({
        tenantId: ctx.tenantId,
        bookingId: booking.id,
        locationId: booking.locationId,
        method: "qr",
        checkedInAt: new Date(),
        checkedInBy: ctx.userId,
      })
      .onConflictDoNothing({
        target: [bookingCheckIns.tenantId, bookingCheckIns.bookingId],
      })
      .returning({
        id: bookingCheckIns.id,
        checkedInAt: bookingCheckIns.checkedInAt,
      });
    // No row came back: the database decided that this booking is already
    // admitted. Nothing was written, and the transaction is still usable.
    if (!entry) return refuse("already_checked_in");

    // R8 — the trail, in the SAME transaction as the entry. The token is
    // deliberately absent from the payload: a pass is not a credential and
    // must not be replayable from the audit log.
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: BOOKING_ENTRY_AUDIT_ACTION,
      entityType: "booking",
      entityId: booking.id,
      after: {
        method: "qr",
        checkedInAt: entry.checkedInAt.toISOString(),
        locationId: booking.locationId,
        invoiceId: booking.invoiceId,
      },
    });

    return {
      ok: true,
      entry: {
        bookingId: booking.id,
        checkedInAt: entry.checkedInAt.toISOString(),
        checkedInBy: actorId,
        method: "qr",
      },
    };
  });
}

export async function readBookingEntry(
  ctx: ActionCtx,
  bookingId: string,
): Promise<BookingEntry | null> {
  const parsed = bookingIdInput.safeParse(bookingId);
  if (!parsed.success) return null;
  if (!ctx.userId) return null;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({
        bookingId: bookingCheckIns.bookingId,
        checkedInAt: bookingCheckIns.checkedInAt,
        checkedInBy: bookingCheckIns.checkedInBy,
        method: bookingCheckIns.method,
        locationId: bookingCheckIns.locationId,
      })
      .from(bookingCheckIns)
      .where(
        and(
          eq(bookingCheckIns.tenantId, ctx.tenantId),
          eq(bookingCheckIns.bookingId, parsed.data),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row || !locationVisible(access, row.locationId)) return null;
    return {
      bookingId: row.bookingId,
      checkedInAt: row.checkedInAt.toISOString(),
      checkedInBy: row.checkedInBy,
      method: row.method as "qr",
    };
  });
}
