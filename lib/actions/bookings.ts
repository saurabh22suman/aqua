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
  readBookingBill,
  requestBookingBill,
  type BookingBillResult,
} from "@/lib/services/booking-billing";
import type { QuoteBookingResult } from "@/lib/services/booking-pricing";

// V-02..V-04 — reception booking actions. Standing preamble: zod
// parse first, permission check next, service call last. Reads ride
// bookings.read; create/cancel ride bookings.write; billing rides
// payments.record, the same key the café billing flow uses.

const bookingIdInput = z.object({ bookingId: z.string().uuid() });

const quoteInput = z.object({
  facilityId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
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
  const parsed = bookingIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "payments.record");
  return requestBookingBill(ctx, parsed.data.bookingId);
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
