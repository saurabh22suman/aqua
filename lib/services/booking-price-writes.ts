import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { bookingPriceRules, type BookingPriceRule } from "@/db/schema/bookings";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  authoriseRuleAccess,
  facilityFor,
} from "@/lib/services/booking-price-scope";
import {
  priceWindowError,
  saveBookingPriceRuleInput,
  setBookingPriceRuleActiveInput,
  toBookingPriceRuleRow,
  type BookingPriceRuleToggleResult,
  type SaveBookingPriceRuleResult,
} from "@/lib/services/booking-price-rules";
import type { ActionCtx } from "@/lib/auth/context";

// Batch 6 — the WRITE half of booking price administration.
//
// Creating, changing and retiring a rule. The read half lives in
// lib/services/booking-price-admin.ts; the typed contract (schema,
// paise conversion, time normalisation) in
// lib/services/booking-price-rules.ts.
//
// The rules this file keeps:
//   * the schema is the existing one — no new table, no new column;
//   * the resolver in lib/services/booking-pricing.ts stays the only
//     thing that decides which rule wins, so overlapping rules are
//     ALLOWED here. A second, conflicting overlap policy would be
//     invented behaviour;
//   * a window that can never match (end not after start) and a half
//     window (one time without the other) are refused — those are
//     configuration mistakes, not prices;
//   * the price is integer paise (bigint), exactly as the resolver
//     reads it and the booking snapshots it;
//   * scope is the tenant, intersected with the caller's locations:
//     a rule attached to a facility inherits that facility's location,
//     and a catch-all rule (facility_id NULL) is tenant-wide, so a
//     location-scoped caller may neither edit nor create one;
//   * every mutation writes its audit row in the SAME transaction.

// The rule being written has to be reachable BEFORE it can be moved or
// changed — otherwise a caller who learned another location's rule id
// could relocate that rule into its own location, or claim a
// tenant-wide rule by pointing it at its own facility. Only the
// destination being reachable is not enough.
//
// The policy itself lives in lib/services/booking-price-scope.ts, so
// the save path and the toggle path cannot drift.

// Create or update one rule. The id decides which: present = update
// that rule, absent = a new one. Every write is one transaction with
// its audit row.
export async function saveBookingPriceRule(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SaveBookingPriceRuleResult> {
  const parsed = saveBookingPriceRuleInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid price rule.",
    };
  }
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  const windowError = priceWindowError(input.startTime, input.endTime);
  if (windowError) return { ok: false, error: windowError };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);

    let existing: BookingPriceRule | undefined;
    if (input.id) {
      const [row] = await tx
        .select()
        .from(bookingPriceRules)
        .where(
          and(
            eq(bookingPriceRules.id, input.id),
            eq(bookingPriceRules.tenantId, ctx.tenantId),
          ),
        )
        .for("update");
      if (!row) return { ok: false, error: "Price rule not found." };
      existing = row;

      // The rule being written must be reachable where it STANDS,
      // before it can be moved or changed. Loading it by id is not
      // authorisation: the id may have come from anywhere.
      const refusal = await authoriseRuleAccess(tx, ctx, access, existing);
      if (refusal) return { ok: false, error: refusal };
    }

    // An update that does not mention a facility keeps the one the
    // rule already had; passing null explicitly makes it a catch-all.
    const effectiveFacilityId =
      input.facilityId === undefined
        ? (existing?.facilityId ?? null)
        : input.facilityId;

    let facilityName: string | null = null;
    if (effectiveFacilityId) {
      const facility = await facilityFor(tx, ctx.tenantId, effectiveFacilityId);
      if (!facility) {
        return { ok: false, error: "Facility not found." };
      }
      if (!locationVisible(access, facility.locationId)) {
        return { ok: false, error: "Facility not found." };
      }
      facilityName = facility.name;
    } else if (!access.unrestricted) {
      return {
        ok: false,
        error: "You can only set prices for facilities at your locations.",
      };
    }

    const daysOfWeek = [...new Set(input.daysOfWeek ?? [])].sort(
      (a, b) => a - b,
    );
    const startTime = input.startTime ?? null;
    const endTime = input.endTime ?? null;
    const priority = input.priority ?? 0;
    const isActive = input.isActive ?? true;

    const [saved] = existing
      ? await tx
          .update(bookingPriceRules)
          .set({
            facilityId: effectiveFacilityId,
            label: input.label,
            daysOfWeek,
            startTime,
            endTime,
            pricePaise: BigInt(input.pricePaise),
            priority,
            isActive,
            updatedBy: actorId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(bookingPriceRules.id, existing.id),
              eq(bookingPriceRules.tenantId, ctx.tenantId),
            ),
          )
          .returning()
      : await tx
          .insert(bookingPriceRules)
          .values({
            tenantId: ctx.tenantId,
            facilityId: effectiveFacilityId,
            label: input.label,
            daysOfWeek,
            startTime,
            endTime,
            pricePaise: BigInt(input.pricePaise),
            priority,
            isActive,
            createdBy: actorId,
            updatedBy: actorId,
          })
          .returning();
    if (!saved) {
      return { ok: false, error: "The price rule could not be saved." };
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: existing
        ? "booking_price_rule.update"
        : "booking_price_rule.create",
      entityType: "booking_price_rule",
      entityId: saved.id,
      before: existing
        ? {
            label: existing.label,
            facilityId: existing.facilityId,
            daysOfWeek: existing.daysOfWeek,
            startTime: existing.startTime,
            endTime: existing.endTime,
            pricePaise: Number(existing.pricePaise),
            priority: existing.priority,
            isActive: existing.isActive,
          }
        : null,
      after: {
        label: saved.label,
        facilityId: saved.facilityId,
        daysOfWeek: saved.daysOfWeek,
        startTime: saved.startTime,
        endTime: saved.endTime,
        pricePaise: Number(saved.pricePaise),
        priority: saved.priority,
        isActive: saved.isActive,
      },
    });

    return {
      ok: true,
      rule: toBookingPriceRuleRow(saved, facilityName),
    };
  });
}

// Activate or deactivate one rule. Deactivating is how a club retires
// a price without deleting the audit trail of what it used to be.
export async function setBookingPriceRuleActive(
  ctx: ActionCtx,
  raw: unknown,
): Promise<BookingPriceRuleToggleResult> {
  const parsed = setBookingPriceRuleActiveInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid price rule." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [existing] = await tx
      .select()
      .from(bookingPriceRules)
      .where(
        and(
          eq(bookingPriceRules.id, parsed.data.id),
          eq(bookingPriceRules.tenantId, ctx.tenantId),
        ),
      )
      .for("update");
    if (!existing) return { ok: false, error: "Price rule not found." };

    // The SAME policy the save path uses: the rule must be reachable
    // where it stands. One policy, two call sites.
    const refusal = await authoriseRuleAccess(tx, ctx, access, existing);
    if (refusal) return { ok: false, error: refusal };

    await tx
      .update(bookingPriceRules)
      .set({
        isActive: parsed.data.isActive,
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookingPriceRules.id, existing.id),
          eq(bookingPriceRules.tenantId, ctx.tenantId),
        ),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "booking_price_rule.update",
      entityType: "booking_price_rule",
      entityId: existing.id,
      before: { isActive: existing.isActive },
      after: { isActive: parsed.data.isActive },
    });

    return { ok: true };
  });
}
