import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { facilities, facilitySubUnits } from "@/db/schema/preset-engine";
import { members } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  checkAdvanceWindowInTx,
  quoteBookingCore,
  resolveBookingPriceInTx,
  type QuoteBookingResult,
} from "@/lib/services/booking-pricing";
import { asMemberId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-02/V-03 — the booking service: create, cancel and the display
// quote; the read side (day board, bookable facilities) lives in
// lib/services/booking-list.ts and is re-exported below.
//
// Overlap is the database's job. createBooking NEVER reads for a
// conflict before inserting — the btree_gist EXCLUDE constraint
// (bookings_no_overlap_excl) decides, and SQLSTATE 23P01 comes back
// as one friendly sentence. Every mutation writes audit_log in the
// same transaction; price and the advance window are re-resolved
// inside the insert's transaction.

export * from "./booking-list";

export const SLOT_TAKEN_ERROR = "That slot is taken. Pick another time.";

const uuid = z.string().uuid();

export const createBookingInput = z
  .object({
    facilityId: uuid,
    subUnitId: uuid.nullish(),
    memberId: uuid.nullish(),
    walkInName: z.string().trim().min(1).max(120).nullish(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(500).nullish(),
  })
  .superRefine((value, ctx) => {
    const hasMember = value.memberId !== undefined && value.memberId !== null;
    const hasWalkIn =
      value.walkInName !== undefined &&
      value.walkInName !== null &&
      value.walkInName.trim().length > 0;
    if (hasMember === hasWalkIn) {
      ctx.addIssue({
        code: "custom",
        message: "Give either a member or a walk-in name, not both.",
      });
    }
    if (new Date(value.endsAt) <= new Date(value.startsAt)) {
      ctx.addIssue({
        code: "custom",
        message: "The end time must be after the start time.",
      });
    }
  });

export type CreateBookingResult =
  | { ok: true; bookingId: string; pricePaise: number }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid booking input.";
}

// Drizzle wraps driver errors in a DrizzleQueryError ("Failed query:
// …") whose `cause` is the pg error; the SQLSTATE lives on the cause
// chain, not on the wrapper. Walk it, with a depth cap so a cyclic
// cause can never loop.
function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function createBooking(
  ctx: ActionCtx,
  raw: unknown,
): Promise<CreateBookingResult> {
  const parsed = createBookingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [facility] = await tx
      .select({ id: facilities.id, locationId: facilities.locationId })
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

    if (input.subUnitId) {
      const [subUnit] = await tx
        .select({ id: facilitySubUnits.id })
        .from(facilitySubUnits)
        .where(
          and(
            eq(facilitySubUnits.id, input.subUnitId),
            eq(facilitySubUnits.tenantId, ctx.tenantId),
            eq(facilitySubUnits.facilityId, input.facilityId),
            isNull(facilitySubUnits.deletedAt),
          ),
        )
        .limit(1);
      if (!subUnit) {
        return {
          ok: false,
          error: "That sub-unit is not part of this facility.",
        };
      }
    }

    if (input.memberId) {
      const [member] = await tx
        .select({ id: members.id })
        .from(members)
        .where(
          and(
            eq(members.id, asMemberId(input.memberId)),
            eq(members.tenantId, ctx.tenantId),
            isNull(members.deletedAt),
          ),
        )
        .limit(1);
      if (!member) return { ok: false, error: "Member not found." };
    }

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

    // No overlap read: insert and let the EXCLUDE constraint decide.
    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(bookings)
        .values({
          tenantId: ctx.tenantId,
          locationId: facility.locationId,
          facilityId: input.facilityId,
          subUnitId: input.subUnitId ?? null,
          memberId: input.memberId ? asMemberId(input.memberId) : null,
          walkInName: input.memberId ? null : (input.walkInName ?? null),
          startsAt,
          endsAt,
          status: "confirmed",
          pricePaise: BigInt(price.pricePaise),
          notes: input.notes ?? null,
          createdBy: actorId,
          updatedBy: actorId,
        })
        .returning({ id: bookings.id });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === "23P01") return { ok: false, error: SLOT_TAKEN_ERROR };
      if (code === "23503" || code === "23514") {
        return { ok: false, error: "That booking could not be saved." };
      }
      throw error;
    }
    if (!inserted) {
      return { ok: false, error: "The booking could not be saved." };
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "booking.create",
      entityType: "booking",
      entityId: inserted.id,
      after: {
        facilityId: input.facilityId,
        subUnitId: input.subUnitId ?? null,
        memberId: input.memberId ?? null,
        walkInName: input.memberId ? null : (input.walkInName ?? null),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: "confirmed",
        pricePaise: price.pricePaise,
        priceRule: price.ruleLabel,
      },
    });

    return {
      ok: true,
      bookingId: inserted.id,
      pricePaise: price.pricePaise,
    };
  });
}

export type CancelBookingResult = { ok: true } | { ok: false; error: string };

export async function cancelBooking(
  ctx: ActionCtx,
  bookingId: string,
): Promise<CancelBookingResult> {
  const parsed = uuid.safeParse(bookingId);
  if (!parsed.success) return { ok: false, error: "Invalid booking." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, parsed.data), eq(bookings.tenantId, ctx.tenantId)),
      )
      .for("update");
    if (!booking || !locationVisible(access, booking.locationId)) {
      return { ok: false, error: "Booking not found." };
    }
    if (booking.status === "completed") {
      return { ok: false, error: "Completed bookings cannot be cancelled." };
    }
    if (booking.status === "cancelled") {
      return { ok: false, error: "This booking is already cancelled." };
    }

    await tx
      .update(bookings)
      .set({
        status: "cancelled",
        updatedBy: actorId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(bookings.id, booking.id), eq(bookings.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      requestId: ctx.requestId ?? null,
      action: "booking.cancel",
      entityType: "booking",
      entityId: booking.id,
      before: { status: booking.status },
      after: { status: "cancelled" },
    });

    return { ok: true };
  });
}

// The display quote for the booking form. The caller validates the
// shape; the core enforces facility visibility, price and window.
// `endsAt` rides along so the form can send the same slot object it
// will create with; the quote only reads the start.
export async function quoteBooking(
  ctx: ActionCtx,
  input: { facilityId: string; startsAt: string; endsAt?: string },
): Promise<QuoteBookingResult> {
  return quoteBookingCore(ctx, input);
}
