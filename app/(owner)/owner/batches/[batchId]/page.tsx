import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
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
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";

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
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireOwner();
  const { batchId } = await params;
  const ctx = await requireDefaultCtx();
  requirePagePermission(ctx, "programs.read");

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

  const summary = await getBatchAttendanceSummary(ctx, batchId, period);
  if (!summary) notFound();

  const canReadAttendance = hasPermission(ctx, "attendance.read");
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
  const terminology = await getTerminologyAction();
  const memberMany = resolveTerm(terminology, "member", "other");

  // R.5 — the queue for this batch (empty state included).
  const [waitlist, batches] = await Promise.all([
    listWaitlistAction({ batchId }),
    listBatchesAction(),
  ]);
  const batch = batches.find((candidate) => candidate.id === batchId);
  const subtitle = [batch?.programName, batch?.locationName]
    .filter(Boolean)
    .join(" · ");

  return (
    <OwnerPage>
      <Link
        href="/owner/programs"
        className="inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <ArrowLeft size={16} aria-hidden="true" />
        Programs &amp; batches
      </Link>

      <PageHeader
        title={summary.batchName}
        purpose={subtitle || "Recurring batch"}
        className="mt-1"
      />

      {canReadAttendance ? <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-paper p-4 sm:p-5">
          <SectionHeading title="Upcoming sessions" />
          <p className="mt-1 text-[12px] text-ink-3">Next 30 days, including today.</p>
          {upcoming === null ? <p role="alert" className="mt-3 text-[13px]">Upcoming sessions could not be loaded. Try again.</p> : upcoming.length === 0 ? <p className="mt-3 text-[13px] text-ink-3">No upcoming sessions in this period.</p> : <>
            <ul className="mt-2 divide-y divide-line">{upcoming.slice(0, 3).map(session => <li key={session.id} className="py-2 text-[13px]">
              <p className="font-medium">{new Intl.DateTimeFormat("en-IN", {timeZone: timezone, day: "numeric", month: "short", weekday: "short"}).format(session.startsAt)}</p>
              <p className="text-ink-3">{new Intl.DateTimeFormat("en-IN", {timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true}).format(session.startsAt)} – {new Intl.DateTimeFormat("en-IN", {timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true}).format(session.endsAt)}{session.coachName ? ` · ${session.coachName}` : ""}</p>
            </li>)}</ul>
            <Link href={`/owner/schedule?view=agenda&date=${upcoming[0].sessionDate}`} className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">Open schedule</Link>
          </>}
        </section>
        {upcoming?.[0] ? <section className="rounded-card border border-line bg-paper p-4 sm:p-5">
          <SectionHeading title="Next session roster" />
          {rosterFailed ? <p role="alert" className="mt-3 text-[13px]">The roster could not be loaded. Try again.</p> : roster && roster.rows.length === 0 ? <p className="mt-3 text-[13px] text-ink-3">{`No ${memberMany} on the next session roster.`}</p> : <ul className="mt-2 divide-y divide-line">{roster?.rows.map(member => <li key={member.memberId} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            {hasPermission(ctx, "members.read") ? <Link href={`/owner/members/${member.memberId}`} className="text-[var(--accent-ink)] underline underline-offset-2">{member.name}</Link> : <span>{member.name}</span>}<span className="text-ink-3">{member.code}</span>
          </li>)}</ul>}
        </section> : null}
      </div> : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section
          className="rounded-card border border-line bg-paper p-4 sm:p-5"
          data-testid="batch-attendance"
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
            {summary.sessionCount === 0
              ? "No sessions have run for this batch this month."
              : `${summary.sessionCount} ${summary.sessionCount === 1 ? "session" : "sessions"} ran this month. Register completion and scheduled sessions are separate measures.`}
          </p>
          <Link
            href={`/owner/reports?from=${period.from}&to=${period.to}`}
            className="mt-4 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
          >
            Open attendance report
          </Link>
        </section>

        <WaitlistBoard
          batchId={batchId}
          initialRows={waitlist}
          canManage={hasPermission(ctx, "enquiries.write")}
        />
      </div>
    </OwnerPage>
  );
}
