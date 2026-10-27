import { z } from "zod";
import type { BookingPriceRule } from "@/db/schema/bookings";

// Batch 6 — the booking price rule CONTRACT.
//
// The pure half of the price administration: what a rule is, how it is
// typed at a boundary, and how a typed amount becomes exact paise.
// No database, no tenant, no clock — which is what makes it cheap to
// pin.
//
// The money rule lives here: the SERVICE stores integer paise (the
// schema's `bigint`), and the ACTION takes the rupees the owner typed
// and converts them here with BigInt. The client never computes money.

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BookingPriceRuleRow = {
  id: string;
  label: string;
  facilityId: string | null;
  facilityName: string | null;
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  pricePaise: number;
  priority: number;
  isActive: boolean;
};

export type SaveBookingPriceRuleResult =
  | { ok: true; rule: BookingPriceRuleRow }
  | { ok: false; error: string };

export type BookingPriceRuleToggleResult =
  | { ok: true }
  | { ok: false; error: string };

export type BookingPriceStatus = { total: number; active: number };

// The rule fields, shared by the service schema and the action
// boundary so the two never drift. The price itself is NOT in the
// shape: the service stores integer paise, the action boundary takes
// the rupees an owner typed and converts them exactly.
export const priceRuleFieldShape = {
  id: z.string().uuid().nullish(),
  label: z.string().trim().min(1, "Give the rule a name.").max(80),
  facilityId: z.string().uuid().nullish(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: z
    .string()
    .regex(TIME_PATTERN, "Use a 24-hour time like 06:00.")
    .nullish(),
  endTime: z
    .string()
    .regex(TIME_PATTERN, "Use a 24-hour time like 22:00.")
    .nullish(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  isActive: z.boolean().optional(),
};

export const saveBookingPriceRuleInput = z.object({
  ...priceRuleFieldShape,
  pricePaise: z.number().int().min(0, "The price cannot be negative."),
});

export const setBookingPriceRuleActiveInput = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});

// The owner's typed amount → exact integer paise. Strict on purpose:
// rupees and paise only, at most two decimal places, no exponent and
// no stray characters. Indian digit grouping ("1,200") is accepted
// because owners type it; anything else is refused rather than
// guessed at.
export function rupeesToPaise(value: string): number | null {
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const rupees = BigInt(match[1]!.replace(/,/g, ""));
  const paise = BigInt((match[2] ?? "").padEnd(2, "0"));
  const total = rupees * 100n + paise;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(total);
}

// A window that can never match is a configuration mistake, not a
// price: the resolver matches [start, end), so end <= start would
// silently never fire. Both times or neither.
export function priceWindowError(
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): string | null {
  const hasStart = startTime !== null && startTime !== undefined;
  const hasEnd = endTime !== null && endTime !== undefined;
  if (hasStart !== hasEnd) {
    return "Give both a start and an end time, or neither.";
  }
  if (hasStart && hasEnd && endTime! <= startTime!) {
    return "The end time must be after the start time.";
  }
  return null;
}

// A `time` column reads back as "07:00:00"; the form and the copy
// speak "07:00". Truncate, never reformat.
export function normaliseTimeColumn(value: string | null): string | null {
  if (value === null) return null;
  const match = /^(\d{2}:\d{2})/.exec(value);
  return match ? match[1]! : value;
}

export function toBookingPriceRuleRow(
  rule: BookingPriceRule,
  facilityName: string | null,
): BookingPriceRuleRow {
  return {
    id: rule.id,
    label: rule.label,
    facilityId: rule.facilityId,
    facilityName,
    daysOfWeek: [...rule.daysOfWeek],
    startTime: normaliseTimeColumn(rule.startTime),
    endTime: normaliseTimeColumn(rule.endTime),
    pricePaise: Number(rule.pricePaise),
    priority: rule.priority,
    isActive: rule.isActive,
  };
}
