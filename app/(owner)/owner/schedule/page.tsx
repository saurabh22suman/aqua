import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { eq } from "drizzle-orm";
import { listLocations } from "@/lib/services/people";
import { getScheduleGridAction } from "@/lib/actions/schedule-grid";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { todayInZone, addDays, weekdayOf } from "@/lib/time/tz";
import { resolveTerm } from "@/lib/terminology/keys";
import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { cookies } from "next/headers";
import { FACILITY_COOKIE } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { ownerFacilityHref, resolveOwnerFacility } from "@/lib/owner-scope/facility";
import {
  parseScheduleDate,
  parseScheduleView,
  scheduleCalendarHref,
  scheduleListHref,
  type ScheduleView,
} from "@/lib/owner-scope/schedule";
import { ScheduleSurfaceSwitch } from "@/components/owner-approved/operations/schedule-surface-switch";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";

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

export default async function OwnerSchedulePage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; date?: string; location?: string; facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "attendance.read");

  const params = searchParams ? await searchParams : {};
  // The page has already authorized attendance.read; this narrow tenant
  // timezone read must not require the unrelated members.read capability.
  const [tenant] = await withTenant(ctx.tenantId, (tx) => tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1));
  const timezone = tenant?.timezone ?? "Asia/Kolkata";
  // One Schedule job: the calendar keeps the owner's chosen day and
  // view, and the List switch carries them to /owner/sessions as return
  // context (the list's own window stays "today + 14 days").
  const view: ScheduleView = parseScheduleView(params.view) ?? "week";
  const today = todayInZone(timezone);
  const anchor = parseScheduleDate(params.date) ?? today;
  const cookieStore = await cookies();
  const scope = resolveOwnerFacility({ facility: params.facility, location: params.location, cookie: cookieStore.get(FACILITY_COOKIE)?.value });
  if (!scope.ok || (scope.facilityId && !(await canSelectFacility(ctx, scope.facilityId)))) {
    return <OwnerPage workflow="planner"><OwnerDesignHeading title="Club unavailable" purpose="This club is unavailable for your account." /><Link href="/owner/schedule?facility=all">View available clubs</Link></OwnerPage>;
  }
  const locationId = scope.facilityId;

  const { fromDate, toDate, days, prevDate, nextDate } = computeWindow(
    view === "agenda" ? "week" : view,
    anchor,
  );
  const chooserDays = computeWindow("week", anchor).days;

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
    listLocations(ctx),
    getTerminologyAction().then(ownerTerminology),
    listUpcomingSessions(ctx, readFrom, toDate, locationId),
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
    ownerFacilityHref(`/owner/schedule?view=${view}&date=${date}`, locationId);

  return (
    <OwnerPage workflow="planner">
      <OwnerDesignHeading
        title="Schedule"
        className="owner-planner-heading"
        action={
          <ScheduleSurfaceSwitch
            active="calendar"
            calendarHref={scheduleCalendarHref({ facilityId: locationId, date: anchor, view })}
            listHref={
              ctx.permissions.has("programs.write")
                ? scheduleListHref({ facilityId: locationId, date: anchor, view })
                : undefined
            }
          />
        }
      />

      <OwnerScheduleGrid
        compactPlanner={ctx.roleKey === "owner" || ctx.roleKey === "manager"}
        canManagePrograms={ctx.permissions.has("programs.read")}
        canEditPrograms={ctx.permissions.has("programs.write")}
        view={view}
        anchor={anchor}
        locationId={locationId}
        locations={locations}
        sessions={sessions}
        days={days}
        chooserDays={chooserDays}
        monthCells={monthCells}
        prevHref={base(prevDate, view)}
        nextHref={base(nextDate, view)}
        todayHref={base(today, view)}
        dayHref={base(anchor, "day")}
        weekHref={base(anchor, "week")}
        monthHref={base(anchor, "month")}
        agendaHref={base(anchor, "agenda")}
        dayHrefs={Object.fromEntries(
          chooserDays.map((day) => [day, base(day, view === "week" ? "week" : "day")]),
        )}
        today={today}
        timezone={timezone}
        categoryLabels={{ batch: resolveTerm(terminology, "batch", 1), booking: "Booking" }}
        coachIds={coachIds}
      />
    </OwnerPage>
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
