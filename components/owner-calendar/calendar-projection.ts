import { addDays, zonedWallTimeToInstant } from "@/lib/time/tz";
import type { CalendarEvent } from "./calendar-model";

// The shared owner calendar — day projection.
//
// An event does not belong to a day, it belongs to a RANGE of days.
// A session that runs from Monday 23:00 into Tuesday 00:30 touches two
// days, and each day owns the part of it that falls inside that day:
//
//   Monday  23:00 – 00:00   the part before midnight
//   Tuesday 00:00 – 00:30   the continuation
//
// The projection is what the grid draws (a block positioned and sized
// by its part of THAT day) and what the agenda orders by (so a session
// still running from last night comes before this morning's). The
// event's own full range is never changed: the detail panel still
// says 23:00 – 00:30 (+1d).

export type DayProjection = {
  event: CalendarEvent;
  /** Minutes from midnight on THAT day. */
  startMinutes: number;
  /** The length of the part that falls on that day, in minutes. */
  durationMinutes: number;
};

const ZONE = "Asia/Kolkata";

/** The UTC instant the day starts, in the display zone. */
function dayStartInstant(dateIso: string): number {
  return zonedWallTimeToInstant(dateIso, "00:00", ZONE).getTime();
}

/** The UTC instant the day ends, in the display zone. */
function dayEndInstant(dateIso: string): number {
  return zonedWallTimeToInstant(addDays(dateIso, 1), "00:00", ZONE).getTime();
}

/**
 * The part of an event that falls on a day, or null when the event does
 * not touch that day at all.
 */
export function projectOntoDay(
  event: CalendarEvent,
  dateIso: string,
): DayProjection | null {
  const dayStart = dayStartInstant(dateIso);
  const dayEnd = dayEndInstant(dateIso);
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  if (start >= dayEnd || end <= dayStart) return null;
  const from = Math.max(start, dayStart);
  const to = Math.min(end, dayEnd);
  return {
    event,
    startMinutes: Math.round((from - dayStart) / 60_000),
    durationMinutes: Math.max(1, Math.round((to - from) / 60_000)),
  };
}

/** The projections of every event onto every day it touches. */
export function projectOntoDays(
  events: ReadonlyArray<CalendarEvent>,
  days: ReadonlyArray<string>,
): Map<string, DayProjection[]> {
  const out = new Map<string, DayProjection[]>();
  for (const day of days) out.set(day, []);
  for (const event of events) {
    for (const day of days) {
      const projection = projectOntoDay(event, day);
      if (!projection) continue;
      out.get(day)!.push(projection);
    }
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        a.startMinutes - b.startMinutes ||
        b.durationMinutes - a.durationMinutes ||
        a.event.id.localeCompare(b.event.id),
    );
  }
  return out;
}

/** The projections of a day, in the order the day runs. */
export function projectionsForDay(
  events: ReadonlyArray<CalendarEvent>,
  day: string,
): DayProjection[] {
  const projections: DayProjection[] = [];
  for (const event of events) {
    const projection = projectOntoDay(event, day);
    if (projection) projections.push(projection);
  }
  projections.sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      b.durationMinutes - a.durationMinutes ||
      a.event.id.localeCompare(b.event.id),
  );
  return projections;
}
