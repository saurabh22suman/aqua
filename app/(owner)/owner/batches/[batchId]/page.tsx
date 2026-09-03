import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Calendar } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { todayInZone } from "@/lib/time/tz";
import { withTenant } from "@/db/tenant";
import { eq } from "drizzle-orm";
import { tenants } from "@/db/schema/tenants";
import { getBatchAttendanceSummary } from "@/lib/services/attendance-history";

// Phase 4.2 — per-batch attendance summary. Service existed
// since C-27 (lib/services/attendance-history.ts), deferred
// then to avoid a merge with #23 (programs/batches board); the
// 4.3 report page (lib/services/owner-reports.ts) actually
// surfaces the same per-batch figure across every batch in its
// rows, but 4.2 wants it on the batch's own surface — when an
// owner drills into a batch from /owner/programs, the month's
// summary is the headline.

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  const summary = await withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const period = (() => {
      const today = todayInZone(tenant?.timezone ?? "Asia/Kolkata");
      const [y, mo] = today.split("-").map(Number);
      const from = `${y}-${String(mo).padStart(2, "0")}-01`;
      const nextMonth = mo === 12 ? { y: y + 1, m: 1 } : { y, m: mo + 1 };
      const to = `${nextMonth.y}-${String(nextMonth.m).padStart(2, "0")}-01`;
      return { from, to };
    })();
    return getBatchAttendanceSummary(
      { tenantId: ctx.tenantId },
      batchId,
      period,
    );
  });
  if (!summary) notFound();

  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/programs"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ArrowLeft size={16} />
        Programs
      </Link>

      <h1 className="font-display text-[19px] font-semibold">{summary.batchName}</h1>
      <p className="mt-1 text-[12.5px] text-ink-3">This calendar month.</p>

      {/* One dominant element: the headline figure. */}
      <div className="mt-5 rounded-card bg-marine px-5 py-5 text-paper">
        <p className="text-[12.5px] font-medium text-paper/70">This month</p>
        <p className="mt-1.5 font-display text-[38px] font-semibold tracking-tight leading-none">
          {summary.pct === null ? "—" : `${summary.pct}%`}
        </p>
        <p className="mt-1.5 text-[13px] text-paper/80">
          {summary.presentMarks} of {summary.totalMarks} marks present across{" "}
          {summary.sessionCount} {summary.sessionCount === 1 ? "session" : "sessions"}
        </p>
      </div>

      {summary.sessionCount > 0 ? (
        <p className="mt-3 text-[12px] text-ink-3">
          Total marks = sessions × enrolled members with attendance rows in this period.
        </p>
      ) : (
        <p className="mt-3 text-[12px] text-ink-3">
          No sessions have run for this batch this month. Markers from later months would land here once the period is widened.
        </p>
      )}

      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <Link
          href={`/owner/reports?from=${periodFrom()}&to=${periodTo()}`}
          className="flex items-center gap-2 text-[13px] font-medium text-ink hover:text-ink-2"
        >
          <BarChart3 size={14} className="text-water" />
          See this month in the reports view
        </Link>
        <Link
          href={`/owner/programs`}
          className="mt-3 flex items-center gap-2 text-[13px] font-medium text-ink hover:text-ink-2"
        >
          <Calendar size={14} className="text-water" />
          Browse all batches
        </Link>
      </div>
    </main>
  );
}

// The summary doesn't carry the period it was computed over,
// so the "See this month in the reports view" link uses today
// as the boundary anchor — the same calendar-month period the
// summary was computed over. Computed inline here (cheap).
function periodFrom(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}
function periodTo(): string {
  return periodFrom();
}
