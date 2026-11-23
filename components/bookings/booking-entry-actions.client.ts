"use client";

import type {
  BookingEntryScanResult,
  MintEntryPassResult,
  ReadEntryPassViewResult,
} from "./booking-entry-shared";

// The only UI module that names the server-action path.
//
// Both imports are dynamic and run only when the staff member presses a
// control, or when the settled receipt's loader asks for its authoritative
// view. That keeps the presentational pass/scanner modules import-safe in
// jsdom (the contract tests inject callbacks and never load `next/headers`),
// while the real product still calls the real Server Actions.
//
// This file deliberately does not catch. A thrown action (forbidden,
// feature-disabled, transport failure) is caught by the request controller in
// `use-booking-entry-pass-view.ts`, which shows a safe generic error and never
// echoes a server error or a raw token.
//
// DEPENDENCY: `@/lib/actions/booking-entry` must exist before this UI packet is
// applied. A dynamic import with a literal path is resolved by the bundler; a
// missing module is a build failure, not a dead click.

export async function mintBookingEntryPass(
  bookingId: string,
): Promise<MintEntryPassResult> {
  const { mintBookingEntryTokenAction } = await import(
    "@/lib/actions/booking-entry"
  );
  return mintBookingEntryTokenAction({ bookingId });
}

export async function scanBookingEntryPass(
  token: string,
): Promise<BookingEntryScanResult> {
  const { checkInBookingAction } = await import("@/lib/actions/booking-entry");
  return checkInBookingAction({ token });
}

/**
 * Read the authoritative pass view for a settled bill.
 *
 * This is a read, not a mint: the action resolves `bookings.read`, the
 * tenant, the location and the current booking/payment/check-in/window facts.
 * A refusal is returned as `{ ok: false }`; a thrown action is left to the
 * caller, which must render `error`, never a fabricated view.
 */
export async function readBookingEntryPassView(
  bookingId: string,
): Promise<ReadEntryPassViewResult> {
  const { readBookingEntryPassViewAction } = await import(
    "@/lib/actions/booking-entry"
  );
  return readBookingEntryPassViewAction({ bookingId });
}
