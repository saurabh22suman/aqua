import { wallClock } from "@/components/owner-calendar/calendar-layout";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";
import { formatINR } from "@/lib/money/format";
import type { BookingDayRow } from "@/lib/services/bookings";

// V-04 — shared booking-form constants. The counter offers hourly
// slots from 06:00 to 21:00 (the last booking ends at 22:00); the
// grid is fixed in R1, independent of business hours, which drive
// the utilisation report rather than the walk-in form.

export const SLOT_STARTS = Array.from({ length: 16 }, (_, index) => {
  const hour = 6 + index;
  return `${String(hour).padStart(2, "0")}:00`;
});

export function slotEnd(slotStart: string): string {
  const [hour, minute] = slotStart.split(":").map(Number);
  const end = (hour! + 1) % 24;
  return `${String(end).padStart(2, "0")}:${String(minute ?? 0).padStart(2, "0")}`;
}

// The calendar's words for the two kinds of event it can show. The
// booking desk only ever shows one of them.
export const BOOKING_CATEGORY_LABELS = {
  batch: "Session",
  booking: "Booking",
};

/**
 * A booking as a calendar event.
 *
 * The exclusive resource is the FACILITY and its lane, because that is
 * what the overlap guarantee covers: a court cannot host two games at
 * once, but two courts in one building can. A held or confirmed
 * booking occupies the slot; a cancelled or completed one does not, so
 * it is never reported as a clash.
 */
export function bookingToCalendarEvent(row: BookingDayRow): CalendarEvent {
  const start = wallClock(row.startsAt);
  const durationMinutes = Math.max(
    1,
    Math.round(
      (new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) /
        60_000,
    ),
  );
  const occupiesSlot = row.status === "held" || row.status === "confirmed";
  const person = row.memberName ?? row.walkInName;

  return {
    id: row.bookingId,
    category: "booking",
    title: person ?? row.facilityName,
    date: start.date,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    startMinutes: start.minutes,
    durationMinutes,
    status: row.status,
    resourceLabel: row.subUnitName
      ? `${row.facilityName} · ${row.subUnitName}`
      : row.facilityName,
    resourceKey: occupiesSlot
      ? `facility:${row.facilityId}|unit:${row.subUnitId ?? "whole"}`
      : null,
    detail: [
      { label: "Facility", value: row.facilityName },
      ...(row.subUnitName
        ? [{ label: "Lane / court", value: row.subUnitName }]
        : []),
      { label: "Booked for", value: person ?? "Not recorded" },
      { label: "Location", value: row.locationName },
      { label: "Amount", value: formatINR(row.pricePaise) },
      ...(row.invoiceNumber
        ? [{ label: "Invoice", value: row.invoiceNumber }]
        : []),
    ],
  };
}
