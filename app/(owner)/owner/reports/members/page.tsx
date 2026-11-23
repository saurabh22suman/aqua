import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getMembersReport } from "@/lib/services/owner-people-reports";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
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
  const terminology = await getTerminologyAction().then(ownerTerminology);
  const memberPlural = resolveTerm(terminology, "member", "other");
  const report = await getMembersReport(ctx, { from: scope.from, to: scope.to, locationId: scope.facility }).catch(() => null);
  if (!report) {
    const query = new URLSearchParams({ period: scope.period, ...(scope.facilityParam ? { facility: scope.facilityParam } : {}) });
    return <OwnerPage workflow="report"><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title={`${titleCase(memberPlural)} report`} /><p role="alert" className="mt-4 text-sm text-ink-2">The {memberPlural} report could not load. <Link href={`/owner/reports/members?${query}`} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Try again</Link></p></OwnerPage>;
  }
  return <OwnerPage workflow="report"><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title={`${titleCase(memberPlural)} report`} />
    <RangeFilter compact={ctx.roleKey === "owner"} period={scope.period} facility={scope.facilityParam} />
    <section data-testid="members-joined-summary" aria-label="Join summary" className="owner-work-panel mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <p className="text-sm text-ink-2"><span className="font-display text-[22px] font-semibold tabular-nums text-ink">{report.joined}</span> joined in this range</p>
      <p className="text-sm text-ink-2"><span className="font-display text-[22px] font-semibold tabular-nums text-ink">{report.joinedUnknown}</span> with join date unknown</p>
    </section>
    <div className="grid min-w-0 items-start gap-x-4 lg:grid-cols-2">
    <DailyChart title={`New ${memberPlural} by day`} emptyMessage={`No recorded joins for ${memberPlural} in this range.`} days={daysBetween(scope.from, scope.to)} values={new Map(report.joinedByDay.map((row) => [row.date, row.count]))} />
    <div className="min-w-0">
    <StatusBars
      title="Current status"
      rows={report.statuses.map((row) => ({ key: row.status, label: row.status, count: row.count }))}
      emptyMessage={`No ${memberPlural} in this scope.`}
    />
    {hasPermission(ctx, "members.read") ? <Link href={`/owner/members?facility=${scope.facility ?? "all"}`}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-ink)]">Open member directory</Link> : null}
    </div>
    </div>
    <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Details</summary><p>Status is a current snapshot, not a historical status. Join date unknown counts current records without a join date, whatever range is selected.</p></details>
  </OwnerPage>;
}
