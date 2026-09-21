import { getAttendanceReportAction, getEnquiryFunnelAction, getRetentionViewAction, getCoachLoadAction, getFacilityUtilisationAction } from "@/lib/actions/owner-reports";
import { getOperationalAnalyticsAction, getMoneyAnalyticsAction } from "@/lib/actions/owner-analytics";
import { defaultMonthPeriod } from "@/lib/services/owner-reports";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";
import { AttendanceReportCard } from "@/components/reports/attendance-report-card";
import { EnquiryFunnelCard } from "@/components/reports/enquiry-funnel-card";
import { RetentionCard } from "@/components/reports/retention-card";
import { CoachLoadCard } from "@/components/reports/coach-load-card";
import { UtilisationCard } from "@/components/reports/utilisation-card";
import {
  AttendanceTrendCard,
  CollectionsExpensesCard,
  MemberMixCard,
  PlanRevenueCard,
} from "@/components/reports/analytics-cards";
import { ReportCardError } from "@/components/reports/report-card-error";
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

  const [
    attendance,
    enquiry,
    retention,
    coachLoad,
    utilisation,
    operational,
    money,
  ] = await Promise.allSettled([
    getAttendanceReportAction(period),
    getEnquiryFunnelAction(period),
    getRetentionViewAction(),
    getCoachLoadAction(period),
    // V-08 — facility utilisation for the last 4 weeks.
    getFacilityUtilisationAction(),
    // U-01 — the analytics series. Operational and financial are
    // separate actions because they carry different permission keys;
    // an owner holds both.
    getOperationalAnalyticsAction(period),
    getMoneyAnalyticsAction(period),
  ] as const);
  const terminology = await getTerminologyAction();

  const attendanceRows = settled(attendance, "Attendance by batch");
  const enquiryRows = settled(enquiry, "Enquiry funnel");
  const retentionRow = settled(retention, "Retention");
  const coachLoadRows = settled(coachLoad, "Coach load");
  const utilisationReport = settled(utilisation, "Facility utilisation");
  const operationalData = settled(operational, "Attendance and member mix");
  const moneyData = settled(money, "Collections and plan revenue");

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

      <Link
        href="/owner/fees"
        className="mt-2 flex items-center justify-between rounded-card border border-line bg-paper px-3.5 py-3"
      >
        <span>
          <span className="block text-[14px] font-medium text-ink">
            Fees &amp; payments
          </span>
          <span className="block text-[12px] text-ink-3">
            Dues, transactions, invoices and plans in one hub.
          </span>
        </span>
        <span className="text-[13px] text-ink-3">→</span>
      </Link>

      <div className="mt-6 space-y-3">
        {attendanceRows ? (
          <AttendanceReportCard rows={attendanceRows} period={period} />
        ) : (
          <ReportCardError title="Attendance by batch" />
        )}
        {operationalData ? (
          <AttendanceTrendCard points={operationalData.attendanceTrend} />
        ) : (
          <ReportCardError title="Attendance trend" />
        )}
        {moneyData ? (
          <CollectionsExpensesCard series={moneyData.collections} />
        ) : (
          <ReportCardError title="Collections vs expenses" />
        )}
        {moneyData ? (
          <PlanRevenueCard rows={moneyData.planRevenue} />
        ) : (
          <ReportCardError title="Revenue by plan" />
        )}
        {operationalData ? (
          <MemberMixCard
            slices={operationalData.memberMix}
            memberLabel={resolveTerm(terminology, "member", "other")}
          />
        ) : (
          <ReportCardError title="Members by status" />
        )}
        {enquiryRows ? (
          <EnquiryFunnelCard rows={enquiryRows} />
        ) : (
          <ReportCardError title="Enquiry funnel" />
        )}
        {retentionRow ? (
          <RetentionCard row={retentionRow} />
        ) : (
          <ReportCardError title="Retention" />
        )}
        {coachLoadRows ? (
          <CoachLoadCard rows={coachLoadRows} />
        ) : (
          <ReportCardError title="Coach load" />
        )}
        {utilisationReport ? (
          <UtilisationCard report={utilisationReport} />
        ) : (
          <ReportCardError title="Facility utilisation" />
        )}
      </div>
    </main>
  );
}

function settled<T>(result: PromiseSettledResult<T>, title: string): T | null {
  if (result.status === "fulfilled") return result.value;
  console.error(`[owner/reports] ${title} failed to load`, result.reason);
  return null;
}
