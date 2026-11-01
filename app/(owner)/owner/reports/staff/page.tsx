import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getStaffReport } from "@/lib/services/owner-people-reports";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { DailyChart, daysBetween, RangeFilter } from "@/components/reports/owner-people/report-shared";
import { reportScope, type ReportParams } from "@/components/reports/owner-people/report-scope";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";

export default async function StaffReportPage({ searchParams }: { searchParams?: Promise<ReportParams> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  requirePagePermission(ctx, "staff.attendance");
  const scope = await reportScope(searchParams);
  const report = await getStaffReport(ctx, { from: scope.from, to: scope.to, locationId: scope.facility });
  const terminology = await getTerminologyAction();
  const checkins = new Map<string, number>();
  for (const row of report.attendance) if (row.checkedIn) checkins.set(row.date, (checkins.get(row.date) ?? 0) + 1);
  const shifts = new Map<string, number>();
  for (const row of report.shifts) shifts.set(row.date, (shifts.get(row.date) ?? 0) + 1);
  const statuses = new Map<string, number>();
  for (const row of report.attendance) statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
  const unassigned = report.attendance.filter((row) => row.locationId === null).length;
  const days = daysBetween(scope.from, scope.to);
  return <OwnerPage><BackLink href={scope.facilityParam ? `/owner/reports?facility=${scope.facilityParam}` : "/owner/reports"} label="All reports" /><PageHeader title="Staff report" />
    <RangeFilter period={scope.period} facility={scope.facilityParam} />
    <DailyChart title="Recorded check-ins by day" emptyMessage="No recorded check-ins in this range." days={days} values={checkins} />
    <DailyChart title="Shifts by day" emptyMessage="No shifts in this range." days={days} values={shifts} />
    <section className="mt-4 rounded-card border border-line bg-paper p-4"><h2 className="font-display text-lg font-semibold">Recorded statuses</h2>
      {statuses.size ? <ul className="mt-2 divide-y divide-line">{Array.from(statuses, ([status, count]) => <li key={status} className="flex justify-between py-2"><span className="capitalize">{status.replaceAll("_", " ")}</span><span>{count}</span></li>)}</ul> : <p className="mt-2 text-sm">No attendance records in this range.</p>}
      <p className="mt-3 text-sm text-ink-3">Unrecorded is not absence. Shifts and attendance are different records.</p>
      {unassigned > 0 ? <p className="mt-2 text-sm">Unassigned records: {unassigned}</p> : null}
      <details className="mt-2 text-sm"><summary className="cursor-pointer">Details</summary><p>Attendance is scoped by its linked shift. Unassigned records appear only in the unrestricted all {resolveTerm(terminology, "facility", "other")} view.</p></details>
    </section>
  </OwnerPage>;
}
