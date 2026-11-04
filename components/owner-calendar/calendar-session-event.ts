import type { GridSessionRow } from "@/lib/services/schedule-grid";
import { timeRange, wallClock } from "./calendar-layout";
import type { CalendarEvent } from "./calendar-model";

// The owner schedule — a session as a calendar event.
//
// The event's IST day comes from the instant, not from the stored date,
// so a late-evening session lands on the day the owner reads it as. Its
// duration is the real one.
//
// The capacity lane's FILL class is decided here, in the file that
// already owns the capacity meaning, and handed to the calendar as a
// class name — the shared calendar stays a layout concern and never
// invents a state colour.
//
// A session's resource key is its COACH, because a coach is the
// exclusive resource (one coach cannot hold two overlapping sessions).
// A location is NOT exclusive: several batches may run in one location
// at the same time, so the calendar never reports that as a conflict.
//
// The block's own line and the agenda's line name BOTH the coach and the
// venue: a class is identified by the hall it runs in as much as by the
// coach who runs it. The venue is already read with the session
// (`GridSessionRow.locationName`), so this is display only — no read, no
// service and no database change.

/**
 * The session's who and where, in the words the owner reads.
 *
 * A missing coach or a missing venue is stated, never invented. The
 * block's line and the detail panel's rows read the SAME two values, so
 * they can never disagree about a session's coach or its hall.
 */
function sessionPeople(session: GridSessionRow): {
  coach: string;
  location: string;
} {
  return {
    coach: session.coachName?.trim() ? session.coachName : "Not assigned",
    location: session.locationName?.trim()
      ? session.locationName
      : "No location",
  };
}

export function sessionToCalendarEvent(
  session: GridSessionRow,
  coachId: string | null,
  /** The lane's fill class — decided by the surface that owns the
   *  capacity meaning, never here. */
  capacityFillClass: string,
): CalendarEvent {
  const start = wallClock(session.startsAt);
  const rawDuration = Math.round(
    (new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) /
      60_000,
  );
  const durationMinutes = Math.max(1, rawDuration);
  const percent =
    session.capacity > 0
      ? Math.min(100, Math.round((session.enrolled / session.capacity) * 100))
      : 0;
  const { coach, location } = sessionPeople(session);

  return {
    id: session.id,
    category: "batch",
    title: session.batchName,
    date: start.date,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    startMinutes: start.minutes,
    durationMinutes,
    status: session.status,
    capacityFillClass,
    capacityPercent: percent,
    capacityLabel: `${session.enrolled} / ${session.capacity}`,
    resourceLabel: `${coach} · ${location}`,
    // The coach is the exclusive resource. A location is not: several
    // batches may share one location at the same time.
    resourceKey: coachId ? `coach:${coachId}` : null,
    detail: [
      { label: "Batch", value: session.batchName },
      {
        label: "Time",
        // The owner's clock is 12-hour: the block, the agenda row and
        // the panel's own heading all read this range, so the detail
        // row must not state the same session on a 24-hour clock. The
        // shared helper also keeps the "(+1d)" truth for a session that
        // runs past midnight.
        value: timeRange(start.minutes, durationMinutes),
      },
      { label: "Coach", value: coach },
      { label: "Location", value: location },
      {
        label: "Places",
        value: `${session.enrolled} enrolled of ${session.capacity}`,
      },
    ],
    href: `/owner/batches/${session.batchId}`,
  };
}
