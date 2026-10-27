"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getBookingPriceStatus,
  listBookingPriceRules,
  priceRuleFieldShape,
  rupeesToPaise,
  saveBookingPriceRule,
  setBookingPriceRuleActive,
  setBookingPriceRuleActiveInput,
  type BookingPriceRuleRow,
  type BookingPriceStatus,
  type BookingPriceRuleToggleResult,
  type SaveBookingPriceRuleResult,
} from "@/lib/services/booking-price-admin";

// Batch 6 — the owner-facing actions for the booking price
// catalogue.
//
// Authority: `settings.manage` is owner/admin only — the receptionist
// role carries `settings.read` but not `settings.manage`, so a
// receptionist cannot administer prices. The read the BOOKING screen
// needs ("is any price configured at all?") rides `bookings.read`,
// the same grant the booking flow itself uses, and returns counts
// only.
//
// Standing preamble: parse, then permission, then service.
//
// The price crosses this boundary as the rupees the owner typed and
// is converted to integer paise HERE, on the server, with exact
// integer arithmetic. The client never computes money.

const saveBookingPriceRuleActionInput = z.object({
  ...priceRuleFieldShape,
  priceRupees: z.string().trim().min(1, "Give the price.").max(20),
});

export async function listBookingPriceRulesAction(): Promise<
  BookingPriceRuleRow[]
> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return listBookingPriceRules(ctx);
}

export async function getBookingPriceStatusAction(): Promise<BookingPriceStatus> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "bookings.read");
  return getBookingPriceStatus(ctx);
}

export async function saveBookingPriceRuleAction(
  raw: unknown,
): Promise<SaveBookingPriceRuleResult> {
  const parsed = saveBookingPriceRuleActionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid price rule.",
    };
  }
  // Permission before any further work: an unauthorised caller gets
  // the refusal, not a conversion.
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  const { priceRupees, ...rest } = parsed.data;
  const pricePaise = rupeesToPaise(priceRupees);
  if (pricePaise === null) {
    return {
      ok: false,
      error: "Use a plain amount like 500 or 500.50.",
    };
  }
  return saveBookingPriceRule(ctx, { ...rest, pricePaise });
}

export async function setBookingPriceRuleActiveAction(
  raw: unknown,
): Promise<BookingPriceRuleToggleResult> {
  const parsed = setBookingPriceRuleActiveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid price rule." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return setBookingPriceRuleActive(ctx, parsed.data);
}
