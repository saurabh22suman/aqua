import { and, asc, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { bookingPriceRules } from "@/db/schema/bookings";
import { facilities } from "@/db/schema/preset-engine";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  toBookingPriceRuleRow,
  type BookingPriceRuleRow,
  type BookingPriceStatus,
} from "@/lib/services/booking-price-rules";
import type { ActionCtx } from "@/lib/auth/context";

// Batch 6 — owner-authorized administration of the booking price
// catalogue (V-03's `booking_price_rules`).
//
// Before this file nothing in the tree could WRITE a price rule, so
// every slot a club offered resolved to "No price is configured for
// this slot" and the reception counter was a dead end (which is why
// `app/(reception)/reception/bookings/page.tsx` 404s).
//
// This module is the public surface of the administration:
//
//   * the READ side (the catalogue and the booking screen's counts) is
//     here;
//   * the WRITE side (create, change, retire) is in
//     lib/services/booking-price-writes.ts;
//   * the typed contract — schema, paise conversion, time
//     normalisation — is in lib/services/booking-price-rules.ts.
//
// Authority for calling it lives in lib/actions/booking-price-admin.ts
// (`settings.manage` — owner/admin; the receptionist role does not
// carry it).

export * from "./booking-price-rules";
export * from "./booking-price-writes";

// The catalogue the owner edits. A rule attached to a facility is
// listed only when that facility is one the caller can reach; a
// catch-all rule is tenant-wide and therefore always visible (it
// prices the caller's own facilities too).
export async function listBookingPriceRules(
  ctx: ActionCtx,
): Promise<BookingPriceRuleRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({
        rule: bookingPriceRules,
        facilityName: facilities.name,
        locationId: facilities.locationId,
      })
      .from(bookingPriceRules)
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, bookingPriceRules.facilityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .where(eq(bookingPriceRules.tenantId, ctx.tenantId))
      .orderBy(asc(bookingPriceRules.priority), asc(bookingPriceRules.label));

    return rows
      .filter(
        (row) =>
          row.rule.facilityId === null ||
          locationVisible(access, row.locationId),
      )
      .map((row) =>
        toBookingPriceRuleRow(row.rule, row.facilityName ?? null),
      );
  });
}

// The counts the booking screen needs to say "no price is configured
// for any slot yet" without handing the whole catalogue to a caller
// whose only question is "is anything configured?".
export async function getBookingPriceStatus(
  ctx: ActionCtx,
): Promise<BookingPriceStatus> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({
        facilityId: bookingPriceRules.facilityId,
        isActive: bookingPriceRules.isActive,
        locationId: facilities.locationId,
      })
      .from(bookingPriceRules)
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, bookingPriceRules.facilityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .where(eq(bookingPriceRules.tenantId, ctx.tenantId));

    const visible = rows.filter(
      (row) =>
        row.facilityId === null || locationVisible(access, row.locationId),
    );
    return {
      total: visible.length,
      active: visible.filter((row) => row.isActive).length,
    };
  });
}
