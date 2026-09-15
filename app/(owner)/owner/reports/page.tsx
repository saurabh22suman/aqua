import { getAttendanceReportAction, getEnquiryFunnelAction, getRetentionViewAction, getCoachLoadAction } from "@/lib/actions/owner-reports";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { formatDateIST } from "@/lib/time/tz";
import { AttendanceReportCard } from "@/components/reports/attendance-report-card";
import { EnquiryFunnelCard } from "@/components/reports/enquiry-funnel-card";
import { RetentionCard } from "@/components/reports/retention-card";
import { CoachLoadCard } from "@/components/reports/coach-load-card";
import { requireOwner } from "@/lib/auth/surface-guard";
import Link from "next/link";

// Phase 4 — owner reports surface. Four cards (4.2 / 4.3 /
// 4.4 / 4.5 / 4.6), one dominant element on each. Period
// defaults to "this calendar month" in the tenant's timezone.
// The page picks up `?from=…&to=…` from the URL when set.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  await requireOwner();
  const params = searchParams ? await searchParams : {};
  const timezone = await getTenantTimezoneAction();
  const period = (() => {
    if (params.from && params.to) return { from: params.from, to: params.to };
    return defaultMonthPeriod(timezone);
  })();

  const [attendance, enquiry, retention, coachLoad] = await Promise.all([
    getAttendanceReportAction(period),
    getEnquiryFunnelAction(period),
    getRetentionViewAction(),
    getCoachLoadAction(period),
  ]);

  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Reports</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Period <span className="font-mono">{formatDateIST(period.from)}</span> to{" "}
        <span className="font-mono">{formatDateIST(period.to)}</span>{" "}
        ({timezone}). This calendar month, in the tenant&apos;s timezone.
      </p>

      <Link
        href="/owner/reports/collections"
        className="mt-4 flex items-center justify-between rounded-card border border-line bg-paper px-3.5 py-3"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">
            Daily collections
          </span>
          <span className="block text-[12px] text-ink-3">
            Counter payments by method and staff, with the cash count.
          </span>
        </span>
        <span className="text-[13px] text-ink-3">→</span>
      </Link>

      <div className="mt-6 space-y-3">
        <AttendanceReportCard rows={attendance} period={period} />
        <EnquiryFunnelCard rows={enquiry} />
        <RetentionCard row={retention} />
        <CoachLoadCard rows={coachLoad} />
      </div>
    </main>
  );
}
