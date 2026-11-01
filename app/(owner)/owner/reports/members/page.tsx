import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getMembersReport } from "@/lib/services/owner-people-reports";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { DailyChart, daysBetween, RangeFilter } from "@/components/reports/owner-people/report-shared";
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
    <section className="mt-4 rounded-card border border-line bg-paper p-4"><h2 className="font-display text-lg font-semibold">Current status</h2>
      {report.statuses.length ? <ul className="mt-2 divide-y divide-line">{report.statuses.map((row) => <li key={row.status} className="flex justify-between py-2"><span className="capitalize">{row.status}</span><span>{row.count}</span></li>)}</ul> : <p className="mt-2 text-sm">No {memberPlural} in this scope.</p>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Details</summary><p>Joined in range: {report.joined}. Join date unknown: {report.joinedUnknown}. Status is a current snapshot, not a historical status.</p></details>
    </section>
  </OwnerPage>;
}
