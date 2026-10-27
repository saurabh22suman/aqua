import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import type { GridSessionRow } from "@/lib/services/schedule-grid";
import {
  addDays,
  formatDateIST,
  zonedWallTimeToInstant,
} from "@/lib/time/tz";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { OwnerCalendar } from "@/components/owner-calendar/owner-calendar";
import { OwnerCalendarMonth } from "@/components/owner-calendar/owner-calendar-month";
import { OwnerCalendarToolbar } from "@/components/owner-calendar/owner-calendar-toolbar";
import { sessionToCalendarEvent } from "@/components/owner-calendar/calendar-session-event";
import type { CalendarEvent } from "@/components/owner-calendar/calendar-model";

// U-04 — the owner schedule.
//
// The week view is now a real calendar: a time ruler down the left,
// one column per day, every session placed at the minute it starts and
// sized by the time it lasts, and two sessions that overlap shown side
// by side rather than stacked on one another. On a phone the same
// sessions are an agenda for the selected day — a seven-column grid is
// not readable at 390px and this product does not scroll sideways.
//
// The month view is the overview: a compact strip that counts what each
// day holds and links into the week.
//
// The controls are the shared ones: the date navigation is the shared
// Button primitive and the day/week/month switch is the shared
// segmented tabs. This file adds no control system of its own.
//
// The capacity lane survives the change. The lane's FILL class is
// decided here, in the file that already owns the capacity meaning,
// and handed to the calendar as a class name — the shared calendar
// stays a layout concern and never invents a state colour.
//
// A session's resource key is its COACH, because a coach is the
// exclusive resource (one coach cannot hold two overlapping sessions).
// A location is NOT exclusive: several batches may run in one location
// at the same time, so the calendar never reports that as a conflict.

export type OwnerScheduleGridProps = {
  view: "day" | "week" | "month" | "agenda";
  // The selected schedule date. View/location switches carry it so the
  // owner does not lose the period they were looking at
  // (owner-UI review P2, 2026-10-13). Defaults to the first rendered
  // day when a caller does not supply one.
  anchor?: string;
  locationId?: string;
  locations: Array<{ id: string; name: string }>;
  sessions: GridSessionRow[];
  days: string[];
  monthCells: Array<{ date: string; inMonth: boolean; count: number }> | null;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  /** The day view's URL. */
  dayHref?: string;
  /** The week view's URL. */
  weekHref?: string;
  /** The month overview's URL. */
  monthHref?: string;
  /** The agenda view's URL. */
  agendaHref?: string;
  /** Where each day opens. */
  dayHrefs?: Record<string, string>;
  /** Today in the academy's timezone. */
  today?: string;
  /** The display zone. */
  timezone?: string;
  /** The words for the two kinds of event on the calendar. */
  categoryLabels?: { batch: string; booking: string };
  /** The coach id behind each session, when the read exposes one. */
  coachIds?: Record<string, string>;
  canManagePrograms?: boolean;
};

const DEFAULT_CATEGORY_LABELS = { batch: "Batch", booking: "Booking" };

export function OwnerScheduleGrid({
  view,
  anchor,
  locationId,
  locations,
  sessions,
  days,
  monthCells,
  prevHref,
  nextHref,
  todayHref,
  dayHref,
  weekHref,
  monthHref,
  agendaHref,
  dayHrefs,
  today,
  timezone = "Asia/Kolkata",
  categoryLabels = DEFAULT_CATEGORY_LABELS,
  coachIds = {},
  canManagePrograms = false,
}: OwnerScheduleGridProps) {
  const anchorDate = anchor ?? days[0] ?? "";
  const selectedDate = days.includes(anchorDate)
    ? anchorDate
    : days[0] ?? anchorDate;
  const rangeLabel =
    view === "month"
      ? formatDateIST(days[0] ?? anchorDate)
      : days.length > 1
        ? `${formatDateIST(days[0] ?? anchorDate)} – ${formatDateIST(days[days.length - 1] ?? anchorDate)}`
        : formatDateIST(days[0] ?? anchorDate);

  const viewTabs =
    dayHref || weekHref || monthHref ? (
      <SegmentedTabs
        ariaLabel="Schedule view"
        active={view}
        tabs={[
          { key: "day", label: "Day", href: dayHref ?? "#" },
          { key: "week", label: "Week", href: weekHref ?? "#" },
          { key: "month", label: "Month", href: monthHref ?? "#" },
          { key: "agenda", label: "Agenda", href: agendaHref ?? "#" },
        ]}
      />
    ) : null;

  const toolbar = (
    <OwnerCalendarToolbar
      navigation={{
        previous: { href: prevHref },
        today: { href: todayHref },
        next: { href: nextHref },
      }}
      rangeLabel={rangeLabel}
      timezone={timezone}
      toolbarExtra={viewTabs}
    />
  );

  if (view === "month") {
    return (
      <div className="mt-4">
        {locations.length > 1 ? (
          <LocationFilter
            view={view}
            anchorDate={anchorDate}
            locationId={locationId}
            locations={locations}
          />
        ) : null}
        {toolbar}
        {monthCells ? (
          <OwnerCalendarMonth
            cells={monthCells}
            hrefFor={(date) =>
              `/owner/schedule?view=week&date=${date}${
                locationId ? `&location=${locationId}` : ""
              }`
            }
          />
        ) : null}
        {canManagePrograms ? (<Link
          href="/owner/programs"
          className="mt-4 inline-flex min-h-[44px] items-center rounded-pill border border-line bg-paper px-4 text-[13px] font-medium text-ink"
        >
          Add a session (via a batch)
        </Link>) : null}
      </div>
    );
  }

  // Only the sessions that TOUCH the visible range are shown. The read
  // starts a day earlier so a session running past midnight is in it;
  // this is where the extra day is dropped again.
  const events: CalendarEvent[] = sessions
    .filter((session) => touchesRange(session, days))
    .map((session) =>
      sessionToCalendarEvent(
        session,
        coachIds[session.id] ?? null,
        capacityFillClass(session),
      ),
    );

  return (
    <div className="mt-4">
      {locations.length > 1 ? (
        <LocationFilter
          view={view}
          anchorDate={anchorDate}
          locationId={locationId}
          locations={locations}
        />
      ) : null}

      {toolbar}

      <OwnerCalendar
        events={events}
        days={days}
        selectedDate={selectedDate}
        todayDate={today ?? null}
        view={view === "agenda" ? "agenda" : view === "day" ? "day" : "week"}
        dayHrefs={dayHrefs}
        labels={categoryLabels}
        empty={{
          title:
            view === "day"
              ? "No sessions scheduled on this day"
              : "No sessions scheduled in this week",
          body: "Sessions come from a batch's weekly schedule. Add or edit a batch to change what appears here.",
          action: canManagePrograms ? { label: "Manage batches", href: "/owner/programs" } : undefined,
        }}
      />

      {canManagePrograms ? (<Link
        href="/owner/programs"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-pill border border-line bg-paper px-4 text-[13px] font-medium text-ink"
      >
        Add a session (via a batch)
      </Link>) : null}
    </div>
  );
}

/**
 * The capacity lane's fill.
 *
 * Under half full is the under-filled state, a full lane is a healthy
 * one, and a cancelled session's lane is quiet. The meaning belongs
 * here, with the capacity it describes.
 */
function capacityFillClass(session: GridSessionRow): string {
  const percent =
    session.capacity > 0
      ? Math.min(100, Math.round((session.enrolled / session.capacity) * 100))
      : 0;
  if (session.status === "cancelled") return "bg-ink-3";
  return percent < 50 ? "bg-warn" : "bg-water";
}

/**
 * Whether a session touches the visible range.
 *
 * The range is the days on show, in the academy's own timezone. A
 * session that started the night before and is still running on the
 * first visible day touches it; one that finished before it does not.
 */
function touchesRange(session: GridSessionRow, days: string[]): boolean {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return true;
  const rangeStart = zonedWallTimeToInstant(
    first,
    "00:00",
    "Asia/Kolkata",
  ).getTime();
  const rangeEnd = zonedWallTimeToInstant(
    addDays(last, 1),
    "00:00",
    "Asia/Kolkata",
  ).getTime();
  const start = new Date(session.startsAt).getTime();
  const end = new Date(session.endsAt).getTime();
  return start < rangeEnd && end > rangeStart;
}

function LocationFilter({
  view,
  anchorDate,
  locationId,
  locations,
}: {
  view: "day" | "week" | "month" | "agenda";
  anchorDate: string;
  locationId?: string;
  locations: Array<{ id: string; name: string }>;
}) {
  return (
    <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="date" value={anchorDate} />
      <label className="block min-w-0 flex-1 sm:w-64 sm:flex-none">
        <span className="mb-0.5 block text-[11px] text-ink-3">Location</span>
        <Select
          name="location"
          defaultValue={locationId ?? ""}
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </label>
      <Button
          variant="primary"
          size="md"
        type="submit">
        Apply
      </Button>
    </form>
  );
}
