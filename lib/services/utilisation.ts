import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookings } from "@/db/schema/bookings";
import { facilities } from "@/db/schema/preset-engine";
import { resolveConfigInTx } from "@/db/config";
import {
  BUSINESS_HOURS_KEY,
  businessHoursSchema,
  type BusinessHours,
} from "@/lib/services/locations";
import { tenantTimezone } from "@/lib/services/bookings";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  addBookingToBuckets,
  buildHourlyBuckets,
  type Bucket,
} from "@/lib/services/utilisation-buckets";
import {
  addDays,
  todayInZone,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// V-08 — facility utilisation: booked minutes ÷ available minutes
// from the location's configured business hours, aggregated by
// facility, day-of-week and hour over the last 4 weeks; plus the
// emptiest recurring slot (lowest-utilisation day+hour bucket).
//
// "Where available" is the honest rule: a location with no business
// hours configured gets availableMinutes = 0, utilisationPct = null
// and emptiest = null. Inventing 9am–9pm would make the report
// confidently wrong about a club's actual hours.
//
// Counted statuses are confirmed and completed. A held booking has
// not committed the slot and a cancelled one freed it — the same
// semantics the EXCLUDE constraint enforces for overlap.

const WEEKS = 4;
const DAYS = WEEKS * 7;

export const utilisationInput = z.object({
  locationId: z.string().uuid().optional(),
});

export type FacilityUtilisationRow = {
  facilityId: string;
  facilityName: string;
  locationId: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilisationPct: number | null;
};

export type UtilisationDayBucket = {
  dayOfWeek: number;
  bookedMinutes: number;
  availableMinutes: number;
  utilisationPct: number | null;
};

export type UtilisationHourBucket = {
  hour: number;
  bookedMinutes: number;
  availableMinutes: number;
  utilisationPct: number | null;
};

export type EmptyRecurringSlot = {
  dayOfWeek: number;
  hour: number;
  bookedMinutes: number;
  availableMinutes: number;
  utilisationPct: number;
};

export type UtilisationReport = {
  fromDate: string;
  toDate: string;
  weeks: number;
  businessHoursConfigured: boolean;
  facilities: FacilityUtilisationRow[];
  byDay: UtilisationDayBucket[];
  byHour: UtilisationHourBucket[];
  emptiest: EmptyRecurringSlot | null;
};

function pct(booked: number, available: number): number | null {
  if (available <= 0) return null;
  return Math.round((booked / available) * 100);
}

function pickEmptiest(buckets: Map<string, Bucket>): EmptyRecurringSlot | null {
  let emptiest: EmptyRecurringSlot | null = null;
  for (const bucket of buckets.values()) {
    if (bucket.availableMinutes <= 0) continue;
    const candidate: EmptyRecurringSlot = {
      dayOfWeek: bucket.dayOfWeek,
      hour: bucket.hour,
      bookedMinutes: Math.round(bucket.bookedMinutes),
      availableMinutes: Math.round(bucket.availableMinutes),
      utilisationPct: Math.round(
        (bucket.bookedMinutes / bucket.availableMinutes) * 100,
      ),
    };
    if (emptiest === null) {
      emptiest = candidate;
      continue;
    }
    // Compare the exact fractions (booked ÷ available), not the
    // rounded percentages: two buckets that round to the same whole
    // percent are not equally empty.
    const comparison =
      candidate.bookedMinutes * emptiest.availableMinutes -
      emptiest.bookedMinutes * candidate.availableMinutes;
    const tieBreaker =
      candidate.bookedMinutes < emptiest.bookedMinutes ||
      (candidate.bookedMinutes === emptiest.bookedMinutes &&
        (candidate.dayOfWeek < emptiest.dayOfWeek ||
          (candidate.dayOfWeek === emptiest.dayOfWeek &&
            candidate.hour < emptiest.hour)));
    if (comparison < 0 || (comparison === 0 && tieBreaker)) {
      emptiest = candidate;
    }
  }
  return emptiest;
}

export async function getFacilityUtilisation(
  ctx: ActionCtx,
  raw: unknown = {},
): Promise<UtilisationReport> {
  const parsed = utilisationInput.safeParse(raw);
  const input = parsed.success ? parsed.data : {};

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const timezone = await tenantTimezone(tx, ctx);
    const toDate = todayInZone(timezone);
    const fromDate = addDays(toDate, -(DAYS - 1));
    const fromUtc = zonedWallTimeToInstant(fromDate, "00:00", timezone);
    const toUtc = zonedWallTimeToInstant(addDays(toDate, 1), "00:00", timezone);

    const facilityPredicates = [
      eq(facilities.tenantId, ctx.tenantId),
      isNull(facilities.deletedAt),
    ];
    if (input.locationId) {
      facilityPredicates.push(eq(facilities.locationId, input.locationId));
    }
    const scoped = locationPredicate(facilities.locationId, access);
    if (scoped) facilityPredicates.push(scoped);

    const facilityRows = await tx
      .select({
        id: facilities.id,
        name: facilities.name,
        locationId: facilities.locationId,
      })
      .from(facilities)
      .where(and(...facilityPredicates))
      .orderBy(facilities.name);

    if (facilityRows.length === 0) {
      return {
        fromDate,
        toDate,
        weeks: WEEKS,
        businessHoursConfigured: false,
        facilities: [],
        byDay: [],
        byHour: [],
        emptiest: null,
      };
    }

    const hoursByLocation = new Map<string, BusinessHours>();
    for (const locationId of new Set(facilityRows.map((r) => r.locationId))) {
      const { value } = await resolveConfigInTx<unknown>(
        tx,
        ctx.tenantId,
        BUSINESS_HOURS_KEY,
        { locationId },
      );
      const parsedHours = businessHoursSchema.safeParse(value);
      hoursByLocation.set(
        locationId,
        parsedHours.success ? parsedHours.data : { days: [] },
      );
    }
    const businessHoursConfigured = [...hoursByLocation.values()].some(
      (hours) => hours.days.some((day) => !day.closed),
    );

    const buckets = buildHourlyBuckets({
      facilities: facilityRows,
      hoursByLocation,
      fromDate,
      days: DAYS,
      timezone,
    });

    const bookingRows = await tx
      .select({
        facilityId: bookings.facilityId,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.tenantId, ctx.tenantId),
          inArray(bookings.status, ["confirmed", "completed"]),
          lt(bookings.startsAt, toUtc),
          gte(bookings.endsAt, fromUtc),
        ),
      );
    for (const booking of bookingRows) {
      addBookingToBuckets(buckets, booking, timezone);
    }

    const facilityRowsOut: FacilityUtilisationRow[] = facilityRows.map(
      (facility) => {
        let booked = 0;
        let available = 0;
        for (const bucket of buckets.values()) {
          if (bucket.facilityId !== facility.id) continue;
          booked += bucket.bookedMinutes;
          available += bucket.availableMinutes;
        }
        return {
          facilityId: facility.id,
          facilityName: facility.name,
          locationId: facility.locationId,
          bookedMinutes: Math.round(booked),
          availableMinutes: Math.round(available),
          utilisationPct: pct(booked, available),
        };
      },
    );

    const byDayMap = new Map<number, { booked: number; available: number }>();
    const byHourMap = new Map<number, { booked: number; available: number }>();
    for (const bucket of buckets.values()) {
      const day = byDayMap.get(bucket.dayOfWeek) ?? { booked: 0, available: 0 };
      day.booked += bucket.bookedMinutes;
      day.available += bucket.availableMinutes;
      byDayMap.set(bucket.dayOfWeek, day);
      const hour = byHourMap.get(bucket.hour) ?? { booked: 0, available: 0 };
      hour.booked += bucket.bookedMinutes;
      hour.available += bucket.availableMinutes;
      byHourMap.set(bucket.hour, hour);
    }

    const byDay: UtilisationDayBucket[] = [...byDayMap.entries()]
      .map(([dayOfWeek, totals]) => ({
        dayOfWeek,
        bookedMinutes: Math.round(totals.booked),
        availableMinutes: Math.round(totals.available),
        utilisationPct: pct(totals.booked, totals.available),
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    const byHour: UtilisationHourBucket[] = [...byHourMap.entries()]
      .map(([hour, totals]) => ({
        hour,
        bookedMinutes: Math.round(totals.booked),
        availableMinutes: Math.round(totals.available),
        utilisationPct: pct(totals.booked, totals.available),
      }))
      .sort((a, b) => a.hour - b.hour);

    return {
      fromDate,
      toDate,
      weeks: WEEKS,
      businessHoursConfigured,
      facilities: facilityRowsOut,
      byDay,
      byHour,
      emptiest: pickEmptiest(buckets),
    };
  });
}
