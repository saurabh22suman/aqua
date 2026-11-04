import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getMembersReport } from "@/lib/services/owner-people-reports";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { DailyChart, daysBetween, RangeFilter, StatusBars } from "@/components/reports/owner-people/report-shared";
import { reportScope, type ReportParams } from "@/components/reports/owner-people/report-scope";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";

export default async function MembersReportPage({ searchParams }: { searchParams?: Promise<ReportParams> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const scope = await reportScope(searchParams);
  const report = await getMembersReport(ctx, { from: scope.from, to: scope.to, locationId: scope.facility });
  const terminology = await getTerminologyAction();
  const memberPlural = resolveTerm(terminology, "member", "other");
  return <OwnerPage><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title={`${titleCase(memberPlural)} report`} />
    <RangeFilter period={scope.period} facility={scope.facilityParam} />
    <DailyChart title={`New ${memberPlural} by day`} emptyMessage={`No recorded joins for ${memberPlural} in this range.`} days={daysBetween(scope.from, scope.to)} values={new Map(report.joinedByDay.map((row) => [row.date, row.count]))} />
    <StatusBars
      title="Current status"
      rows={report.statuses.map((row) => ({ key: row.status, label: row.status, count: row.count }))}
      emptyMessage={`No ${memberPlural} in this scope.`}
    />
    <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Details</summary><p>Joined in range: {report.joined}. Join date unknown: {report.joinedUnknown}. Status is a current snapshot, not a historical status.</p></details>
  </OwnerPage>;
}
