import {
  addDays,
  weekdayOf,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import type { BusinessHours } from "@/lib/services/locations";

// V-08 — the hourly-bucket grid behind the utilisation report, split
// out of lib/services/utilisation.ts for the 300-line rule.
//
// A bucket is one hour of one calendar day at one facility, but only
// where the location's business hours make that hour available. The
// map key is facility|date|hour, so a booking is distributed by
// walking only the hours it actually spans — O(bookings × hours per
// booking), not O(bookings × buckets).

export const HOUR_MS = 3_600_000;
export const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type Bucket = {
  facilityId: string;
  dayOfWeek: number;
  hour: number;
  startsAt: Date;
  endsAt: Date;
  availableMinutes: number;
  bookedMinutes: number;
};

export function hourKey(
  facilityId: string,
  dateIso: string,
  hour: number,
): string {
  return `${facilityId}|${dateIso}|${hour}`;
}

export function localDateAndHour(
  instant: Date,
  timeZone: string,
): { dateIso: string; hour: number } {
  const dateIso = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(instant),
  );
  return { dateIso, hour: hour % 24 };
}

export function buildHourlyBuckets({
  facilities,
  hoursByLocation,
  fromDate,
  days,
  timezone,
}: {
  facilities: Array<{ id: string; locationId: string }>;
  hoursByLocation: Map<string, BusinessHours>;
  fromDate: string;
  days: number;
  timezone: string;
}): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (const facility of facilities) {
    const hours = hoursByLocation.get(facility.locationId);
    if (!hours) continue;
    for (let back = 0; back < days; back++) {
      const dateIso = addDays(fromDate, back);
      const dayName = DAY_NAMES[weekdayOf(dateIso)];
      const day = hours.days.find((candidate) => candidate.day === dayName);
      if (!day || day.closed) continue;
      const open = zonedWallTimeToInstant(dateIso, day.open, timezone);
      const close = zonedWallTimeToInstant(dateIso, day.close, timezone);
      const [openHour] = day.open.split(":").map(Number);
      const [closeHour, closeMinute] = day.close.split(":").map(Number);
      const lastHour = closeMinute === 0 ? closeHour! : closeHour! + 1;
      for (let hour = openHour!; hour < lastHour; hour++) {
        const startsAt = zonedWallTimeToInstant(
          dateIso,
          `${String(hour).padStart(2, "0")}:00`,
          timezone,
        );
        const endsAt = new Date(startsAt.getTime() + HOUR_MS);
        const availableMinutes =
          (Math.min(endsAt.getTime(), close.getTime()) -
            Math.max(startsAt.getTime(), open.getTime())) /
          60_000;
        if (availableMinutes <= 0) continue;
        buckets.set(hourKey(facility.id, dateIso, hour), {
          facilityId: facility.id,
          dayOfWeek: weekdayOf(dateIso),
          hour,
          startsAt,
          endsAt,
          availableMinutes,
          bookedMinutes: 0,
        });
      }
    }
  }
  return buckets;
}

export function addBookingToBuckets(
  buckets: Map<string, Bucket>,
  booking: { facilityId: string; startsAt: Date; endsAt: Date },
  timezone: string,
): void {
  if (buckets.size === 0) return;
  const start = booking.startsAt;
  const end = booking.endsAt;
  let { dateIso, hour } = localDateAndHour(start, timezone);
  const endParts = localDateAndHour(end, timezone);
  let guard = 0;
  while (
    (dateIso < endParts.dateIso ||
      (dateIso === endParts.dateIso && hour < endParts.hour)) &&
    guard < 24 * 365
  ) {
    const bucket = buckets.get(hourKey(booking.facilityId, dateIso, hour));
    if (bucket) {
      const overlap =
        (Math.min(bucket.endsAt.getTime(), end.getTime()) -
          Math.max(bucket.startsAt.getTime(), start.getTime())) /
        60_000;
      if (overlap > 0) bucket.bookedMinutes += overlap;
    }
    hour += 1;
    if (hour > 23) {
      hour = 0;
      dateIso = addDays(dateIso, 1);
    }
    guard += 1;
  }
}
