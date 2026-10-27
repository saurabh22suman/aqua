import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { listLocationsAction } from "@/lib/actions/people";
import { getScheduleGridAction } from "@/lib/actions/schedule-grid";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { todayInZone, addDays, weekdayOf, formatDateIST } from "@/lib/time/tz";
import { resolveTerm } from "@/lib/terminology/keys";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

// U-04 — owner schedule surface.
//
// A day column or a week column over the existing batches/sessions
// data, with the capacity lane per session and a per-location filter.
// The month strip is the overview; the day and week views are the
// schedule. Read-only; the add-session entry point leads to the batch
// editor because sessions are generated from batch recurrence (C-19).
//
// The calendar needs the coach behind each session to know which
// sessions genuinely clash — a coach is the exclusive resource, a
// location is not. The grid read carries the coach's name; this page
// pairs it with the session list, which carries the id.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampAnchor(value: string | undefined, fallback: string): string {
  return value && DATE_RE.test(value) ? value : fallback;
}

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; date?: string; location?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "attendance.read");

  const params = searchParams ? await searchParams : {};
  const timezone = await getTenantTimezoneAction();
  const view =
    params.view === "month"
      ? "month"
      : params.view === "day"
        ? "day"
        : params.view === "agenda"
          ? "agenda"
          : "week";
  const today = todayInZone(timezone);
  const anchor = clampAnchor(params.date, today);
  const locationId = params.location;

  const { fromDate, toDate, days, prevDate, nextDate } = computeWindow(
    view === "agenda" ? "week" : view,
    anchor,
  );

  // The read starts a day EARLIER than the visible range: a session
  // that runs from the previous night into the first visible day is
  // part of what the owner is looking at. The range itself is applied
  // to the events afterwards, so the extra day is never shown as a
  // day of its own.
  const readFrom = addDays(fromDate, -1);

  const [sessions, locations, terminology, upcoming] = await Promise.all([
    getScheduleGridAction({
      fromDate: readFrom,
      toDate,
      ...(locationId ? { locationId } : {}),
    }),
    listLocationsAction(),
    getTerminologyAction(),
    listUpcomingSessions(ctx, readFrom, toDate),
  ]);

  const coachIds: Record<string, string> = {};
  for (const row of upcoming) {
    if (row.coachId) coachIds[row.id] = row.coachId;
  }

  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.sessionDate, (counts.get(session.sessionDate) ?? 0) + 1);
  }
  const monthCells =
    view === "month"
      ? buildMonthCells(fromDate, toDate).map((cell) => ({
          ...cell,
          count: counts.get(cell.date) ?? 0,
        }))
      : null;

  const base = (date: string, view: "day" | "week" | "month" | "agenda") =>
    `/owner/schedule?view=${view}&date=${date}${
      locationId ? `&location=${locationId}` : ""
    }`;

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/sessions" label="Sessions" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">Schedule</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        {view === "month"
          ? `Month of ${formatDateIST(days[0] ?? anchor)}`
          : view === "day"
            ? formatDateIST(days[0] ?? anchor)
            : `Week of ${formatDateIST(days[0] ?? anchor)}`}
        . Each bar is enrolled against the batch&apos;s capacity.
      </p>

      <OwnerScheduleGrid
        canManagePrograms={ctx.permissions.has("programs.read")}
        view={view}
        anchor={anchor}
        locationId={locationId}
        locations={locations}
        sessions={sessions}
        days={days}
        monthCells={monthCells}
        prevHref={base(prevDate, view)}
        nextHref={base(nextDate, view)}
        todayHref={base(today, view)}
        dayHref={base(anchor, "day")}
        weekHref={base(anchor, "week")}
        monthHref={base(anchor, "month")}
        agendaHref={base(anchor, "agenda")}
        dayHrefs={Object.fromEntries(
          days.map((day) => [day, base(day, "day")]),
        )}
        today={today}
        timezone={timezone}
        categoryLabels={{ batch: resolveTerm(terminology, "batch", 1), booking: "Booking" }}
        coachIds={coachIds}
      />
    </main>
  );
}

type ScheduleWindow = {
  fromDate: string;
  toDate: string;
  days: string[];
  prevDate: string;
  nextDate: string;
};

function computeWindow(
  view: "day" | "week" | "month",
  anchor: string,
): ScheduleWindow {
  if (view === "day") {
    return {
      fromDate: anchor,
      toDate: anchor,
      days: [anchor],
      prevDate: addDays(anchor, -1),
      nextDate: addDays(anchor, 1),
    };
  }
  if (view === "week") {
    const dow = weekdayOf(anchor);
    const monday = addDays(anchor, -(dow === 0 ? 6 : dow - 1));
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    return {
      fromDate: days[0]!,
      toDate: days[6]!,
      days,
      // The selected day keeps its weekday as the week moves.
      prevDate: addDays(anchor, -7),
      nextDate: addDays(anchor, 7),
    };
  }

  const monthStart = `${anchor.slice(0, 7)}-01`;
  const nextMonth = `${addDays(monthStart, 32).slice(0, 7)}-01`;
  const lastDay = addDays(nextMonth, -1);
  const days: string[] = [];
  for (let date = monthStart; date <= lastDay; date = addDays(date, 1)) {
    days.push(date);
  }
  return {
    fromDate: monthStart,
    toDate: lastDay,
    days,
    prevDate: addDays(monthStart, -1),
    nextDate: addDays(lastDay, 1),
  };
}

// A Monday-first 6×7 grid covering the month, matching the week view's
// day ordering so a cell and its section read the same way.
function buildMonthCells(
  monthStart: string,
  lastDay: string,
): Array<{ date: string; inMonth: boolean }> {
  const firstDow = weekdayOf(monthStart);
  const gridStart = addDays(monthStart, -(firstDow === 0 ? 6 : firstDow - 1));
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    cells.push({ date, inMonth: date >= monthStart && date <= lastDay });
  }
  return cells;
}
