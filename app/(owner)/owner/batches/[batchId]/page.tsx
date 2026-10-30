import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { todayInZone } from "@/lib/time/tz";
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

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section
          className="rounded-card border border-line bg-paper p-5"
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
