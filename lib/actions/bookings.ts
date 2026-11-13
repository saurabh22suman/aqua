"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  cancelBooking,
  createBooking,
  createBookingInput,
  listBookableFacilities,
  listBookingsForDay,
  listBookingsForDayInput,
  quoteBooking,
  type BookableFacility,
  type BookingDayRow,
  type CancelBookingResult,
  type CreateBookingResult,
} from "@/lib/services/bookings";
import {
  REISSUE_NAME_INVALID_ERROR,
  readBookingBill,
  requestBookingBill,
  type BookingBillResult,
} from "@/lib/services/booking-billing";
import type { QuoteBookingResult } from "@/lib/services/booking-pricing";

// V-02..V-04 — reception booking actions. Standing preamble: zod
// parse first, permission check next, service call last. Reads ride
// bookings.read; create/cancel ride bookings.write; billing rides
// payments.record, the same key the café billing flow uses.
//
// WR-12 PASS (2026-11-05) — the bill request may carry the CORRECTED
// buyer's name for a REPLACEMENT document.
//
// NO NEW ACTION, NO NEW PERMISSION. The name is an OPTIONAL field on
// the EXISTING action, and the action's permission is unchanged
// (payments.record — the same key the action-permission map already
// records for requestBookingBillAction in lib/auth/action-permissions.ts).
// The permission map is therefore NOT changed by this pass.
//
// The action does NOT decide whether the name may be applied. That is
// the service's rule and the service's refusals (a member booking, a
// live bill, a booking that was never billed): the action only
// validates the shape of the field, so a malformed name is a clear
// message rather than a silent drop.

const bookingIdInput = z.object({ bookingId: z.string().uuid() });

const quoteInput = z.object({
  facilityId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
});

// The bill request's input. `guestName` is the corrected buyer's name
// for a replacement document: trimmed, 1..120 characters — the same
// bound the booking's own name and the invoice's own name carry.
const bookingBillInput = z.object({
  bookingId: z.string().uuid(),
  guestName: z.string().trim().min(1).max(120).optional(),
});

export async function listBookableFacilitiesAction(): Promise<
  BookableFacility[]
> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  return listBookableFacilities(ctx);
}

export async function listBookingsAction(
  raw: unknown,
): Promise<BookingDayRow[]> {
  const parsed = listBookingsForDayInput.safeParse(raw);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  return listBookingsForDay(ctx, parsed.data);
}

export async function quoteBookingAction(
  raw: unknown,
): Promise<QuoteBookingResult> {
  const parsed = quoteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Pick a facility and a time slot." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  return quoteBooking(ctx, parsed.data);
}

export async function createBookingAction(
  raw: unknown,
): Promise<CreateBookingResult> {
  const parsed = createBookingInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid booking.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.write");
  return createBooking(ctx, parsed.data);
}

export async function cancelBookingAction(
  raw: unknown,
): Promise<CancelBookingResult> {
  const parsed = bookingIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.write");
  return cancelBooking(ctx, parsed.data.bookingId);
}

export async function requestBookingBillAction(
  raw: unknown,
): Promise<BookingBillResult> {
  const parsed = bookingBillInput.safeParse(raw);
  if (!parsed.success) {
    // A malformed NAME gets the name's message, not "Invalid booking.":
    // the operator typed a name, and "Invalid booking." would send them
    // looking in the wrong place.
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "guestName") {
      return { ok: false, error: REISSUE_NAME_INVALID_ERROR };
    }
    return { ok: false, error: "Invalid booking." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return requestBookingBill(ctx, parsed.data.bookingId, {
    guestName: parsed.data.guestName ?? null,
  });
}

export async function readBookingBillAction(
  raw: unknown,
): Promise<BookingBillResult> {
  const parsed = bookingIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return readBookingBill(ctx, parsed.data.bookingId);
}
