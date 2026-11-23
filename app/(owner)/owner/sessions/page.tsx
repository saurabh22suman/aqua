import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { listCoaches } from "@/lib/services/programs";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { daysAheadWindow } from "@/lib/time/tz";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { ScheduleSurfaceSwitch } from "@/components/owner-approved/operations/schedule-surface-switch";
import { cookies } from "next/headers";
import { FACILITY_COOKIE } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { ownerFacilityHref, resolveOwnerFacility } from "@/lib/owner-scope/facility";
import {
  SCHEDULE_CALENDAR_PATH,
  parseScheduleDate,
  parseScheduleView,
  scheduleCalendarHref,
  scheduleListHref,
} from "@/lib/owner-scope/schedule";

// F3 (R.1) — owner-facing upcoming-sessions page. Lists every
// scheduled session in the tenant over the next two weeks, with
// its current coach and a per-row substitute control. This is
// the surface the audit's R.1 promised ("Coach substitution —
// records who actually took the session. ... If substitution
// does not write the substitute, the wrong coach is paid and
// the bug is invisible from the register surface.").
//
// Audit simplification (21 November 2026) — this is the LIST surface
// of the single Schedule job, not a separate destination. The
// Calendar / List switch is in the heading; program setup stays on
// /owner/programs. The URL and the programs.write guard are unchanged.
//
// The `date`/`view` parameters are return context for the calendar
// only. The list keeps its shipped "today + 14 days" upcoming window
// and Today / Next 7 days / Full window filters: adding a date anchor
// here would change what the list MEANS, so it is deliberately not
// applied to the query.

export default async function SessionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string; location?: string; date?: string; view?: string }>;
}) {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePagePermission(ctx, "programs.write");

  const params = (await searchParams) ?? {};
  const cookieStore = await cookies();
  const scope = resolveOwnerFacility({
    facility: params.facility,
    location: params.location,
    cookie: cookieStore.get(FACILITY_COOKIE)?.value,
  });
  if (!scope.ok || (scope.facilityId && !(await canSelectFacility(ctx, scope.facilityId)))) {
    return (
      <OwnerPage workflow="planner">
        <OwnerDesignHeading
          title="Facility unavailable"
          purpose="This facility is unavailable for your account."
        />
        <Link href="/owner/sessions?facility=all">View available facilities</Link>
      </OwnerPage>
    );
  }
  const facility = scope.facilityId;

  const returnDate = parseScheduleDate(params.date);
  const returnView = parseScheduleView(params.view);

  const timezone = await getTenantTimezoneAction();
  const { fromDate, toDate } = daysAheadWindow(timezone, 14);

  const [upcoming, coaches, terminology] = await Promise.all([
    listUpcomingSessions(ctx, fromDate, toDate, facility),
    listCoaches(ctx),
    // The substitute coach picker labels itself with closed-key
    // `coach` (L3 audit).
    getTerminologyAction().then(ownerTerminology),
  ]);

  // Only an authorized calendar is offered; only a valid carried day
  // and view are replayed, otherwise the calendar opens on its own
  // default rather than on a broken anchor.
  const calendarHref = hasPermission(ctx, "attendance.read")
    ? returnDate && returnView
      ? scheduleCalendarHref({ facilityId: facility, date: returnDate, view: returnView })
      : ownerFacilityHref(SCHEDULE_CALENDAR_PATH, facility)
    : undefined;
  const listHref = scheduleListHref({
    facilityId: facility,
    date: returnDate,
    view: returnView,
  });

  return (
    <OwnerPage workflow="planner">
      <OwnerDesignHeading
        title="Schedule"
        purpose="Find a session to change its coach, time or status."
        action={
          <>
            <ScheduleSurfaceSwitch
              active="list"
              calendarHref={calendarHref}
              listHref={listHref}
            />
            {hasPermission(ctx, "programs.read") ? <Link
              href={ownerFacilityHref("/owner/programs", facility)}
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              Programs &amp; batches
            </Link> : null}
          </>
        }
      />

      <div className="mt-5">
        <UpcomingSessionsList
          key={facility ?? "all"}
          initialSessions={upcoming}
          coaches={coaches}
          terminology={terminology}
          timezone={timezone}
          dateWindow={{ fromDate, toDate }}
          compactOwner={ctx.roleKey === "owner"}
          canManage={hasPermission(ctx, "programs.write")}
        />
      </div>
    </OwnerPage>
  );
}
