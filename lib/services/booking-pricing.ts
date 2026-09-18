import { and, eq, isNull, or } from "drizzle-orm";
import { resolveConfigInTx } from "@/db/config";
import { withTenant, type TenantTx } from "@/db/tenant";
import { bookingPriceRules } from "@/db/schema/bookings";
import { facilities } from "@/db/schema/preset-engine";
import { tenants } from "@/db/schema/tenants";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";
import type { BookingPriceRule } from "@/db/schema/bookings";

// V-03 — the booking price resolver.
//
// A rule matches a slot when:
//   * it is active and belongs to the tenant;
//   * its facility_id is NULL (all facilities) or the booking's;
//   * its days_of_week is empty (every day) or contains the local
//     day of week (0 = Sunday);
//   * its window is NULL (all day) or the local start minute is in
//     [start_time, end_time).
//
// The winner is the most specific match: highest priority first, then
// a facility-specific rule over the catch-all, then the narrowest
// time window, then the narrower day set. No matching rule is an
// honest refusal — never a silent zero.
//
// The advance window is the config key `bookings.advance_window_days`
// (default 30), resolved tenant/location scope inside the caller's
// transaction.

export const ADVANCE_WINDOW_KEY = "bookings.advance_window_days" as const;

export type BookingPriceResult =
  | { ok: true; pricePaise: number; ruleId: string; ruleLabel: string }
  | { ok: false; error: string };

// The tenant-local day of week (0 = Sunday) and minute of day for an
// instant. The formatters are cached per timezone: Intl construction
// is the expensive part and a booking form re-quotes on every field
// change.
const zoneFormatters = new Map<
  string,
  { date: Intl.DateTimeFormat; clock: Intl.DateTimeFormat }
>();

function formattersFor(timeZone: string) {
  let cached = zoneFormatters.get(timeZone);
  if (!cached) {
    cached = {
      date: new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }),
      clock: new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    };
    zoneFormatters.set(timeZone, cached);
  }
  return cached;
}

export function localDayAndMinutes(
  instant: Date,
  timeZone: string,
): { dayOfWeek: number; minutes: number } {
  const { date, clock } = formattersFor(timeZone);
  const [year, month, day] = date.format(instant).split("-").map(Number);
  const [hour, minute] = clock.format(instant).split(":").map(Number);
  // Date.UTC's day-of-week is the calendar day-of-week for that local
  // date — the zone offset is already baked into the formatted parts.
  const dayOfWeek = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return { dayOfWeek, minutes: hour! * 60 + minute! };
}

function timeToMinutes(value: string | null): number | null {
  if (value === null) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined) return null;
  return hour * 60 + minute;
}

function windowMinutes(rule: BookingPriceRule): number {
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  if (start === null || end === null) return Number.MAX_SAFE_INTEGER;
  return end - start;
}

function matches(
  rule: BookingPriceRule,
  dayOfWeek: number,
  minutes: number,
): boolean {
  if (rule.daysOfWeek.length > 0 && !rule.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }
  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  if (start !== null && end !== null) {
    if (minutes < start || minutes >= end) return false;
  }
  return true;
}

// Exported for the ordering test: highest priority, then
// facility-specific, then narrowest window, then narrower day set.
export function compareRules(a: BookingPriceRule, b: BookingPriceRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const facilityA = a.facilityId === null ? 1 : 0;
  const facilityB = b.facilityId === null ? 1 : 0;
  if (facilityA !== facilityB) return facilityA - facilityB;
  const windowA = windowMinutes(a);
  const windowB = windowMinutes(b);
  if (windowA !== windowB) return windowA - windowB;
  const daysA = a.daysOfWeek.length === 0 ? 1 : 0;
  const daysB = b.daysOfWeek.length === 0 ? 1 : 0;
  if (daysA !== daysB) return daysA - daysB;
  return a.id.localeCompare(b.id);
}

async function timezoneOf(tx: TenantTx, tenantId: TenantId): Promise<string> {
  const [row] = await tx
    .select({ timezone: tenants.timezone })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.timezone ?? "Asia/Kolkata";
}

export async function resolveBookingPriceInTx(
  tx: TenantTx,
  tenantId: TenantId,
  facilityId: string,
  startsAt: Date,
): Promise<BookingPriceResult> {
  const timeZone = await timezoneOf(tx, tenantId);
  const { dayOfWeek, minutes } = localDayAndMinutes(startsAt, timeZone);

  const rules = await tx
    .select()
    .from(bookingPriceRules)
    .where(
      and(
        eq(bookingPriceRules.tenantId, tenantId),
        eq(bookingPriceRules.isActive, true),
        or(
          eq(bookingPriceRules.facilityId, facilityId),
          isNull(bookingPriceRules.facilityId),
        ),
      ),
    );

  const chosen = rules
    .filter((rule) => matches(rule, dayOfWeek, minutes))
    .sort(compareRules)[0];

  if (!chosen) {
    return { ok: false, error: "No price is configured for this slot." };
  }
  return {
    ok: true,
    pricePaise: Number(chosen.pricePaise),
    ruleId: chosen.id,
    ruleLabel: chosen.label,
  };
}

// The advance-booking window. Returns the user-facing refusal, or null
// when the start is inside the window. `now` is injectable so tests
// pin the boundary instead of racing the clock.
export async function checkAdvanceWindowInTx(
  tx: TenantTx,
  tenantId: TenantId,
  locationId: string | null,
  startsAt: Date,
  now: Date = new Date(),
): Promise<string | null> {
  const { value } = await resolveConfigInTx<number>(
    tx,
    tenantId,
    ADVANCE_WINDOW_KEY,
    locationId ? { locationId } : {},
  );
  const maxDays =
    typeof value === "number" && Number.isFinite(value) ? value : 30;
  const limit = now.getTime() + maxDays * 86_400_000;
  if (startsAt.getTime() > limit) {
    return `Bookings can be made up to ${maxDays} days ahead.`;
  }
  return null;
}

// The quote entry point the reception form calls: facility visibility,
// price and the advance window in one withTenant() read. Create
// re-resolves all three inside its own transaction — the quote is for
// display, never an input to a write.
export type QuoteBookingResult =
  | { ok: true; pricePaise: number; ruleLabel: string }
  | { ok: false; error: string };

export async function quoteBookingCore(
  ctx: ActionCtx,
  input: { facilityId: string; startsAt: string },
): Promise<QuoteBookingResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [facility] = await tx
      .select({ locationId: facilities.locationId })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, input.facilityId),
          eq(facilities.tenantId, ctx.tenantId),
          isNull(facilities.deletedAt),
        ),
      )
      .limit(1);
    if (!facility || !locationVisible(access, facility.locationId)) {
      return { ok: false, error: "Facility not found." };
    }
    const startsAt = new Date(input.startsAt);
    const price = await resolveBookingPriceInTx(
      tx,
      ctx.tenantId,
      input.facilityId,
      startsAt,
    );
    if (!price.ok) return price;
    const windowError = await checkAdvanceWindowInTx(
      tx,
      ctx.tenantId,
      facility.locationId,
      startsAt,
    );
    if (windowError) return { ok: false, error: windowError };
    return {
      ok: true,
      pricePaise: price.pricePaise,
      ruleLabel: price.ruleLabel,
    };
  });
}
