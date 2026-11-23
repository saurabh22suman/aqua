import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { addDays, todayInZone } from "@/lib/time/tz";
import { listUpcomingSessions, type UpcomingSessionRow } from "@/lib/services/coach-schedule";
import { getRosterForSession, type RosterData } from "@/lib/services/register";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { withTenant } from "@/db/tenant";
import { eq } from "drizzle-orm";
import { tenants } from "@/db/schema/tenants";
import {
  currentMonthPeriod,
  getBatchAttendanceSummary,
} from "@/lib/services/attendance-history";
import { listWaitlistAction } from "@/lib/actions/waitlist";
import { listBatchesAction } from "@/lib/actions/programs";
import { WaitlistBoard } from "@/components/waitlist-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { OwnerSectionLinks } from "@/components/owner-ui/owner-section-links";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { ownerFacilityHref, resolveOwnerFacility } from "@/lib/owner-scope/facility";

// Phase 4.2 — per-batch attendance summary, recomposed for the owner
// OpenPen reference (29 October 2026): compact evidence beside the
// ordered waitlist, not a marketing hero. The month's summary stays the
// headline; register completion is never presented as attendance.
//
// The tenant timezone is read in its own short transaction, then the
// service is called outside that scope: opening withTenant here and
// calling getBatchAttendanceSummary inside it nests with the service's
// own withTenant and trips enterScope's "Cannot enter tenant scope
// while already inside a tenant scope" guard (db/scope.ts).

function monthLabel(date: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    timeZone: timezone,
  }).format(new Date(`${date}T12:00:00Z`));
}

export default async function BatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams?: Promise<{ facility?: string; location?: string }>;
}) {
  await requireOwner();
  const { batchId } = await params;
  const ctx = await requireDefaultCtx();
  requirePagePermission(ctx, "programs.read");
  const query = await searchParams ?? {};
  const hasExplicitScope = query.facility !== undefined || query.location !== undefined;
  const scope = resolveOwnerFacility(query);
  if (!scope.ok || (scope.facilityId && !(await canSelectFacility(ctx, scope.facilityId)))) {
    return <OwnerPage workflow="record"><PageHeader title="Facility unavailable" purpose="This facility is unavailable for your account." /><Link href="/owner/programs?facility=all">View available facilities</Link></OwnerPage>;
  }
  const scopedHref = (path: string) => hasExplicitScope ? ownerFacilityHref(path, scope.facilityId) : path;

  const [tenant] = await withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1),
  );
  const timezone = tenant?.timezone ?? "Asia/Kolkata";
  const today = todayInZone(timezone);
  const period = currentMonthPeriod(today);

  const canReadAttendance = hasPermission(ctx, "attendance.read");
  const canReadReport = hasPermission(ctx, "reports.operational") && hasFeature(ctx, "reports");
  const batches = await listBatchesAction();
  const batch = batches.find((candidate) => candidate.id === batchId);
  if (!batch) notFound();
  const summary = canReadAttendance ? await getBatchAttendanceSummary(ctx, batchId, period) : null;
  if (canReadAttendance && !summary) notFound();
  let upcoming: UpcomingSessionRow[] | null = null;
  let roster: RosterData | null = null;
  let rosterFailed = false;
  if (canReadAttendance) {
    try {
      const now = Date.now();
      const sessions = await listUpcomingSessions(ctx, today, addDays(today, 29));
      upcoming = sessions.filter((session) => session.batchId === batchId && session.status !== "cancelled" && session.endsAt.getTime() > now)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    } catch {
      upcoming = null;
    }
    if (upcoming?.[0]) {
      try {
        roster = await getRosterForSession(ctx, upcoming[0].id);
        if (!roster) rosterFailed = true;
      } catch {
        rosterFailed = true;
      }
    }
  }
  const terminology = await getTerminologyAction().then(ownerTerminology);
  const memberMany = resolveTerm(terminology, "member", "other");

  // R.5 — the queue for this batch (empty state included).
  const waitlist = hasPermission(ctx, "enquiries.read") ? await listWaitlistAction({ batchId }) : null;
  const subtitle = [batch?.programName, batch?.locationName]
    .filter(Boolean)
    .join(" · ");

  const nextSession = upcoming?.[0];
  const retryPath = scopedHref(`/owner/batches/${batchId}`);
  const scheduleDate = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "numeric", month: "short", weekday: "short" });
  const scheduleTime = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true });

  return (
    <OwnerPage workflow="record">
      <Link
        href={scopedHref("/owner/programs")}
        className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Programs &amp; batches
      </Link>

      <PageHeader
        title={batch.name}
        purpose={subtitle || "Recurring batch"}
        className="mt-1"
      />
      <section className="owner-work-panel mt-4" aria-label="Batch details">
        <dl className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
          <div><dt className="text-ink-3">Time</dt><dd>{batch.startTime.slice(0, 5)} – {batch.endTime.slice(0, 5)}</dd></div>
          <div><dt className="text-ink-3">Coach</dt><dd>{batch.coachName ?? "No coach assigned"}</dd></div>
          <div><dt className="text-ink-3">Capacity</dt><dd>{batch.capacity} places</dd></div>
        </dl>
      </section>
      <OwnerSectionLinks label="Batch sections" className="mt-3" sections={[
        ...(canReadAttendance ? [{ id:"next-batch-session", label:"Next session" }] : []),
        ...(summary ? [{ id:"batch-attendance-history", label:"Attendance history" }] : []),
        ...(waitlist !== null ? [{ id:"batch-waitlist", label:"Waitlist" }] : []),
      ]} />
      {!canReadAttendance && canReadReport ? <Link
        href={scopedHref(`/owner/reports?from=${period.from}&to=${period.to}`)}
        className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
      >Open attendance report</Link> : null}

      {canReadAttendance ? (
        <section aria-labelledby="next-batch-session" className="mt-4 overflow-hidden rounded-card border border-line bg-paper">
          <div className="grid min-w-0 gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <h2 tabIndex={-1} id="next-batch-session" className="text-[16px] font-semibold text-ink">Next session</h2>
              {upcoming === null ? (
                <div className="mt-2">
                  <p role="alert" className="text-[13px]">Upcoming sessions could not be loaded.</p>
                  <a href={retryPath} className="inline-flex min-h-11 items-center text-[13px] font-medium text-water underline">Retry schedule</a>
                </div>
              ) : nextSession ? (
                <>
                  <p className="mt-2 text-[21px] font-semibold leading-tight text-ink">{scheduleDate.format(nextSession.startsAt)}</p>
                  <p className="mt-1 text-[14px] text-ink-2">{scheduleTime.format(nextSession.startsAt)} – {scheduleTime.format(nextSession.endsAt)}</p>
                  <p className="mt-1 text-[13px] text-ink-2">{nextSession.coachName ?? "No coach assigned"} · {nextSession.locationName ?? batch.locationName ?? "Location unavailable"}</p>
                  <Link href={scopedHref(`/owner/schedule?view=agenda&date=${nextSession.sessionDate}`)} className="mt-1 inline-flex min-h-11 items-center text-[13px] font-medium text-water underline underline-offset-2">Open schedule</Link>
                </>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">No upcoming sessions in this period.</p>
              )}
            </div>

            {nextSession ? (
              <div className="min-w-0 border-t border-line pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[15px] font-semibold text-ink">Next {resolveTerm(terminology, "session", 1)} roster</h3>
                  {roster ? <span className="text-[12px] tabular-nums text-ink-3">{roster.rows.length} on roster</span> : null}
                </div>
                {rosterFailed ? (
                  <div className="mt-2">
                    <p role="alert" className="text-[13px]">The roster could not be loaded.</p>
                    <a href={retryPath} className="inline-flex min-h-11 items-center text-[13px] font-medium text-water underline">Retry roster</a>
                  </div>
                ) : roster && roster.rows.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-3">{`No ${memberMany} on the next session roster.`}</p>
                ) : <ul className="mt-2 divide-y divide-line">
                  {roster?.rows.map((member) => (
                    <li key={member.memberId} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-1 text-[13px]">
                      {hasPermission(ctx, "members.read") ? <Link href={scopedHref(`/owner/members/${member.memberId}`)} className="inline-flex min-h-11 items-center break-words text-water underline underline-offset-2">{member.name}</Link> : <span>{member.name}</span>}
                      <span className="text-ink-3">{member.code}</span>
                    </li>
                  ))}
                </ul>}
              </div>
            ) : null}
          </div>
          {upcoming && upcoming.length > 1 ? (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <h3 className="text-[13px] font-medium text-ink">Following sessions</h3>
              <ul className="divide-y divide-line text-[13px] sm:grid sm:grid-cols-2 sm:gap-4 sm:divide-y-0">
                {upcoming.slice(1, 3).map((session) => (
                  <li key={session.id} className="py-2">
                    <p className="font-medium text-ink">{scheduleDate.format(session.startsAt)}</p>
                    <p className="text-ink-3">{scheduleTime.format(session.startsAt)} – {scheduleTime.format(session.endsAt)}{session.coachName ? ` · ${session.coachName}` : ""}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* items-start here too: the month's attendance evidence and the
          waitlist are separate panels, not an equal-height comparison. */}
      <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {summary ? <section
          className="rounded-card border border-line bg-paper p-4 sm:p-5"
          tabIndex={-1} id="batch-attendance-history" data-testid="batch-attendance"
        >
          <SectionHeading title={`${monthLabel(period.from, timezone)} attendance`} />
          {summary.pct === null ? (
            <p className="mt-3 text-[13px] text-ink-3">
              No attendance marks have been recorded in this period.
            </p>
          ) : (
            <>
              <p className="mt-2 font-display text-[30px] font-semibold leading-none tracking-tight">
                {summary.pct}%
              </p>
              <p className="mt-2 text-[13px] text-ink-2">
                {summary.presentMarks} Present or Late out of {summary.totalMarks}{" "}
                recorded marks.
              </p>
            </>
          )}
          <p className="mt-1.5 text-[12px] text-ink-3">
            {/* A CALENDAR quantity: the summary counts every session row in
                the month — future and cancelled entries included — so it is
                not proof that a class ran or was held. The marks above are
                the only attendance evidence on this card, and the method
                sentence does not belong repeated on this line. */}
            {summary.sessionCount === 0
              ? "No sessions on the calendar this month."
              : `${summary.sessionCount} ${summary.sessionCount === 1 ? "session" : "sessions"} on the calendar.`}
          </p>
          {canReadReport ? <Link
            href={scopedHref(`/owner/reports?from=${period.from}&to=${period.to}`)}
            className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
          >
            Open attendance report
          </Link> : null}
        </section> : null}

        {waitlist !== null ? <div tabIndex={-1} id="batch-waitlist"><WaitlistBoard
          batchId={batchId}
          batchName={batch.name}
          initialRows={waitlist}
          canManage={hasPermission(ctx, "enquiries.write")}
        /></div> : null}
      </div>
    </OwnerPage>
  );
}
