import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getStaffReport } from "@/lib/services/owner-people-reports";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { DailyChart, daysBetween, RangeFilter, StatusBars } from "@/components/reports/owner-people/report-shared";
import { reportScope, type ReportParams } from "@/components/reports/owner-people/report-scope";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { addDays } from "@/lib/time/tz";
import { resolveTerm } from "@/lib/terminology/keys";

export default async function StaffReportPage({ searchParams }: { searchParams?: Promise<ReportParams> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  requirePagePermission(ctx, "staff.attendance");
  const scope = await reportScope(searchParams);
  const report = await getStaffReport(ctx, { from: scope.from, to: scope.to, locationId: scope.facility }).catch(() => null);
  if (!report) {
    const query = new URLSearchParams({ period: scope.period, ...(scope.facilityParam ? { facility: scope.facilityParam } : {}) });
    return <OwnerPage workflow="report"><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title="Staff report" /><p role="alert" className="mt-4 text-sm text-ink-2">The staff report could not load. <Link href={`/owner/reports/staff?${query}`} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Try again</Link></p></OwnerPage>;
  }
  const terminology = await getTerminologyAction().then(ownerTerminology);
  const checkins = new Map<string, number>();
  for (const row of report.attendance) if (row.checkedIn) checkins.set(row.date, (checkins.get(row.date) ?? 0) + 1);
  const shifts = new Map<string, number>();
  for (const row of report.shifts) shifts.set(row.date, (shifts.get(row.date) ?? 0) + 1);
  const statuses = new Map<string, number>();
  for (const row of report.attendance) statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
  const unassigned = report.attendance.filter((row) => row.locationId === null).length;
  const checkInTotal = [...checkins.values()].reduce((sum, count) => sum + count, 0);
  const shiftTotal = report.shifts.length;
  const days = daysBetween(scope.from, scope.to);
  return <OwnerPage workflow="report"><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title="Staff report" />
    <RangeFilter compact={ctx.roleKey === "owner"} period={scope.period} facility={scope.facilityParam} />
    <section data-testid="staff-summary" aria-label="Staff record totals" className="owner-work-panel mt-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <p className="text-sm text-ink-2"><span className="font-display text-[22px] font-semibold tabular-nums text-ink">{checkInTotal}</span> recorded check-ins</p>
      <p className="text-sm text-ink-2"><span className="font-display text-[22px] font-semibold tabular-nums text-ink">{shiftTotal}</span> shifts</p>
      {!scope.facility ? <Link href={`/owner/staff/attendance?date=${addDays(scope.to, -1)}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-ink)]">Open staff attendance</Link> : null}
    </section>
    <div className="grid min-w-0 items-start gap-x-4 lg:grid-cols-2">
    <DailyChart title="Recorded check-ins by day" emptyMessage="No recorded check-ins in this range." days={days} values={checkins} />
    <DailyChart title="Shifts by day" emptyMessage="No shifts in this range." days={days} values={shifts} />
    </div>
    <StatusBars
      title="Recorded statuses"
      rows={Array.from(statuses, ([status, count]) => ({ key: status, label: status.replaceAll("_", " "), count }))}
      emptyMessage="No attendance records in this range."
      note="Unrecorded is not absence. Shifts and attendance are different records."
    />
    {unassigned > 0 ? <p className="mt-2 text-sm">Unassigned records: {unassigned}</p> : null}
    <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Details</summary><p>Attendance is scoped by its linked shift. Unassigned records appear only in the unrestricted all {resolveTerm(terminology, "facility", "other")} view.</p></details>
  </OwnerPage>;
}
