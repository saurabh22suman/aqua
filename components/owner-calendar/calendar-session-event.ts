import { formatWallTime24hIST } from "@/lib/time/tz";
import type { GridSessionRow } from "@/lib/services/schedule-grid";
import { wallClock } from "./calendar-layout";
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
    resourceLabel: session.coachName,
    // The coach is the exclusive resource. A location is not: several
    // batches may share one location at the same time.
    resourceKey: coachId ? `coach:${coachId}` : null,
    detail: [
      { label: "Batch", value: session.batchName },
      {
        label: "Time",
        value: `${formatWallTime24hIST(session.startsAt)}–${formatWallTime24hIST(session.endsAt)}`,
      },
      { label: "Coach", value: session.coachName ?? "Not assigned" },
      { label: "Location", value: session.locationName ?? "No location" },
      {
        label: "Places",
        value: `${session.enrolled} enrolled of ${session.capacity}`,
      },
    ],
    href: `/owner/batches/${session.batchId}`,
  };
}

