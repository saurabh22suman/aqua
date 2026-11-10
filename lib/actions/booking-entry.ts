"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  checkInBooking,
  mintBookingEntryToken,
  type BookingEntry,
  type BookingEntryReason,
} from "@/lib/services/booking-entry";
import { readBookingEntryPassFacts } from "@/lib/services/booking-entry-view";
import {
  passViewFromAuthoritative,
  type ReadEntryPassViewResult,
} from "@/components/bookings/booking-entry-shared";

// The paid-booking entry actions.
//
// Standing preamble (G6/G7): Zod parse FIRST, permission check SECOND,
// service call LAST. A malformed input is refused as an input error BEFORE
// any permission is consulted.
//
// checkInBookingAction rides bookings.write — it records an arrival.
// mintBookingEntryTokenAction rides bookings.read — it signs a claim about a
// booking the caller can see. Both permissions are in the pool.booking
// module, so requirePermission also enforces the tenant's booking
// entitlement.
//
// readBookingEntryPassViewAction is a READ. It rides the SAME `bookings.read`
// the mint action requires; it adds no permission key. It reads the booking
// status, the exact linked invoice's money, the check-in row and the
// server-derived entry window under the existing tenant/location boundaries.
// It returns a view only after the permission check; a missing/out-of-reach
// booking is an `ok: false` refusal, never a default view.
//
// The three map entries are in lib/auth/action-permissions.ts. That file is a
// protected path; this packet delivers the exact insertion, not a full-file
// replacement.

const tokenInput = z.object({ token: z.string().min(1).max(4096) });
const bookingIdInput = z.object({ bookingId: z.string().uuid() });

export type CheckInActionResult =
  | { ok: true; entry: BookingEntry }
  | { ok: false; error: string; reason: BookingEntryReason };

export type MintActionResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; error: string };

export async function checkInBookingAction(
  raw: unknown,
): Promise<CheckInActionResult> {
  const parsed = tokenInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: "That pass is not valid.",
      reason: "invalid_token",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.write");
  return checkInBooking(ctx, parsed.data);
}

export async function mintBookingEntryTokenAction(
  raw: unknown,
): Promise<MintActionResult> {
  const parsed = bookingIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  return mintBookingEntryToken(ctx, parsed.data.bookingId);
}

/**
 * The settled receipt's authoritative pass view.
 *
 * The permission check is the `canMint` decision. It is the same
 * `bookings.read` that `mintBookingEntryTokenAction` requires and that the
 * owner page already requires to render the desk. Passing `true` to the mapper
 * after this line is therefore a server decision, not a client default.
 *
 * A null facts result means "not found, not in this tenant, outside the
 * caller's location, an unreadable linked invoice, or an amount that cannot be
 * represented exactly". It is deliberately returned as `ok: false`: the UI
 * shows an availability error and offers no pass.
 */
export async function readBookingEntryPassViewAction(
  raw: unknown,
): Promise<ReadEntryPassViewResult> {
  const parsed = bookingIdInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  const facts = await readBookingEntryPassFacts(ctx, parsed.data.bookingId);
  if (!facts) {
    return {
      ok: false,
      error: "Entry pass availability could not be checked.",
    };
  }
  return { ok: true, view: passViewFromAuthoritative(facts, true) };
}
