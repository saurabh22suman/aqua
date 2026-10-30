// The shared owner calendar — layout arithmetic.
//
// Pure functions only: no React, no server imports, no clock reads
// beyond what the caller passes in. The grid and the agenda both read
// their geometry from here, so "where does this event sit" has exactly
// one answer.
//
// The display zone is Asia/Kolkata, the product's canonical zone
// (lib/time/tz.ts formats every wall clock the same way).

import { addDays, formatWallTime12h, weekdayOf } from "@/lib/time/tz";
import type {
  CalendarEvent,
  CalendarGeometry,
  PlacedCalendarEvent,
} from "./calendar-model";
import { projectOntoDay, type DayProjection } from "./calendar-projection";

export type WallClock = {
  /** yyyy-mm-dd in the display zone. */
  date: string;
  /** Minutes from midnight in the display zone. */
  minutes: number;
};

const WALL_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** The IST wall clock for an instant. */
export function wallClock(iso: string): WallClock {
  const parts = WALL_CLOCK.formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "0";
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
  };
}

/**
 * The wall clock for a minute count.
 *
 * Minutes past midnight wrap to the next day's wall clock: 25:30 is
 * 01:30. A clamped "24:00" is not a time of day, so it is never
 * produced — the day context is carried by `timeRange` instead.
 */
export function minutesToClock(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const withinDay = total % (24 * 60);
  const hour = Math.floor(withinDay / 60);
  const minute = withinDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes from midnight for a "HH:MM" string. */
export function clockToMinutes(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Groups events by their display-zone day, keeping each day's order. */
export function bucketByDate(
  events: ReadonlyArray<CalendarEvent>,
): Map<string, CalendarEvent[]> {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = buckets.get(event.date) ?? [];
    list.push(event);
    buckets.set(event.date, list);
  }
  for (const list of buckets.values()) {
    list.sort(
      (a, b) =>
        a.startMinutes - b.startMinutes ||
        b.durationMinutes - a.durationMinutes ||
        a.id.localeCompare(b.id),
    );
  }
  return buckets;
}

/**
 * The ids of events that genuinely clash.
 *
 * Two events clash only when they share a resource key AND their real
 * time ranges overlap. The overlap is judged on the INSTANTS, not on
 * the wall clock of the day they start in: a session that runs from
 * Monday 23:00 into Tuesday 00:30 really does overlap a Tuesday 00:00
 * session, and grouping by the starting day would never let the two
 * meet.
 *
 * The resource key is the EXCLUSIVE resource, not a shared place: two
 * batches may run in one location at the same time, so a location is
 * never a key. A cancelled event occupies no slot at all.
 */
export function detectClashes(
  events: ReadonlyArray<CalendarEvent>,
): Set<string> {
  const byResource = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!event.resourceKey) continue;
    if (event.status === "cancelled") continue;
    const list = byResource.get(event.resourceKey) ?? [];
    list.push(event);
    byResource.set(event.resourceKey, list);
  }

  const clashing = new Set<string>();
  for (const list of byResource.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (overlapsInstants(a, b)) {
          clashing.add(a.id);
          clashing.add(b.id);
        }
      }
    }
  }
  return clashing;
}

/** The canonical interval overlap, on the real instants. */
function overlapsInstants(a: CalendarEvent, b: CalendarEvent): boolean {
  const aStart = new Date(a.startsAt).getTime();
  const aEnd = new Date(a.endsAt).getTime();
  const bStart = new Date(b.startsAt).getTime();
  const bEnd = new Date(b.endsAt).getTime();
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Places one day's projections on the time ruler.
 *
 * Overlapping events are given side-by-side columns so neither is
 * hidden behind the other; a cluster of three gets three columns. An
 * event that starts exactly when another ends does not overlap it.
 *
 * The placement is DAY-RELATIVE: a block is positioned and sized by
 * the part of the event that falls in this day, so a session that runs
 * past midnight contributes its continuation to the next day's track.
 */
export function layoutDay(
  projections: ReadonlyArray<DayProjection>,
  geometry: CalendarGeometry,
  /** The clashes of the WHOLE visible range, not only of this day. */
  clashes?: ReadonlySet<string>,
): PlacedCalendarEvent[] {
  const clashing = clashes ?? detectClashes(projections.map((p) => p.event));
  const sorted = [...projections].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      b.durationMinutes - a.durationMinutes ||
      a.event.id.localeCompare(b.event.id),
  );

  const placed: PlacedCalendarEvent[] = [];
  let cluster: DayProjection[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const columnOf = new Map<string, number>();
    for (const projection of cluster) {
      const column = columnEnds.findIndex(
        (end) => end <= projection.startMinutes,
      );
      const index = column === -1 ? columnEnds.length : column;
      if (column === -1) columnEnds.push(0);
      columnEnds[index] = projection.startMinutes + projection.durationMinutes;
      columnOf.set(projection.event.id, index);
    }
    const columns = columnEnds.length;
    for (const projection of cluster) {
      placed.push({
        event: projection.event,
        top:
          (projection.startMinutes - geometry.dayStartMinutes) *
          geometry.pixelsPerMinute,
        height: projection.durationMinutes * geometry.pixelsPerMinute,
        column: columnOf.get(projection.event.id) ?? 0,
        columns,
        clash: clashing.has(projection.event.id),
      });
    }
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const projection of sorted) {
    if (cluster.length > 0 && projection.startMinutes >= clusterEnd) flush();
    cluster.push(projection);
    clusterEnd = Math.max(
      clusterEnd,
      projection.startMinutes + projection.durationMinutes,
    );
  }
  flush();

  return placed;
}

/**
 * The window the ruler actually draws.
 *
 * The bounds come from what the VISIBLE DAYS show, not from the raw
 * events: a session that runs past midnight is projected onto each day
 * it touches, and each day's part is capped to that day. So a Tuesday
 * continuation at 00:00 pulls the ruler's start to midnight (the block
 * is never clipped above the track), and a Monday session that runs
 * past midnight never stretches the ruler past the end of a day.
 *
 * The base window is the academy's working day, but it is only a
 * starting point: a session before it or after it EXTENDS the ruler
 * rather than being clipped out of sight. Supported schedule data is
 * never hidden by the ruler's own bounds.
 */
export function resolveGeometry(
  events: ReadonlyArray<CalendarEvent>,
  base: CalendarGeometry,
  /** The days on show. Defaults to each event's own day. */
  days?: ReadonlyArray<string>,
): CalendarGeometry {
  let dayStartMinutes = base.dayStartMinutes;
  let dayEndMinutes = base.dayEndMinutes;
  for (const event of events) {
    for (const day of days ?? [event.date]) {
      const projection = projectOntoDay(event, day);
      if (!projection) continue;
      const start = clampToDay(projection.startMinutes);
      const end = clampToDay(
        projection.startMinutes + projection.durationMinutes,
      );
      if (start < dayStartMinutes) {
        dayStartMinutes = Math.floor(start / 60) * 60;
      }
      if (end > dayEndMinutes) {
        dayEndMinutes = Math.ceil(end / 60) * 60;
      }
    }
  }
  return { ...base, dayStartMinutes, dayEndMinutes };
}

/** A minute count inside one day. */
function clampToDay(minutes: number): number {
  return Math.max(0, Math.min(24 * 60, minutes));
}

export type CalendarRange = {
  /** The days on show, in order. */
  days: string[];
  /** The anchor one step back. */
  previousDate: string;
  /** The anchor one step forward. */
  nextDate: string;
};

const WEEKDAY_SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
});

const DAY_OF_MONTH = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
});

/** "Tue" for a calendar day. */
export function weekdayShort(dateIso: string): string {
  return WEEKDAY_SHORT.format(new Date(`${dateIso}T00:00:00Z`));
}

/** "27" for a calendar day. */
export function dayOfMonth(dateIso: string): string {
  return DAY_OF_MONTH.format(new Date(`${dateIso}T00:00:00Z`));
}

/**
 * The whole days a range spans. 1 means the range ends on the next
 * day, 2 on the day after that.
 */
export function dayGap(startMinutes: number, endMinutes: number): number {
  return (
    Math.floor(endMinutes / (24 * 60)) - Math.floor(startMinutes / (24 * 60))
  );
}

/**
 * "7:00 am – 8:00 am" for an event, in the display zone.
 *
 * A range that ends on the next day says so: "11:00 pm – 1:00 am
 * (+1d)". The clock alone cannot say which day 1:00 am belongs to.
 */
export function timeRange(
  startMinutes: number,
  durationMinutes: number,
): string {
  const end = startMinutes + durationMinutes;
  const gap = dayGap(startMinutes, end);
  const range = `${formatWallTime12h(minutesToClock(startMinutes))} – ${formatWallTime12h(minutesToClock(end))}`;
  return gap > 0 ? `${range} (+${gap}d)` : range;
}

/**
 * The visible range for a view.
 *
 * The week runs Monday to Sunday, matching the order the day list and
 * the month strip already read in.
 */
export function calendarRange(
  anchorDate: string,
  view: "day" | "week",
): CalendarRange {
  if (view === "day") {
    return {
      days: [anchorDate],
      previousDate: addDays(anchorDate, -1),
      nextDate: addDays(anchorDate, 1),
    };
  }
  const weekday = weekdayOf(anchorDate);
  const monday = addDays(anchorDate, -(weekday === 0 ? 6 : weekday - 1));
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  return {
    days,
    previousDate: addDays(monday, -7),
    nextDate: addDays(monday, 7),
  };
}
