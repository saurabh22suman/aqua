import Link from "next/link";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { FACILITY_COOKIE, parseFacilityValue, resolveFacilityValue } from "@/lib/facility";
import { isOwnerPeriodKey, resolveOwnerPeriod } from "@/lib/time/owner-periods";
import { addDays, formatPeriodRangeIST } from "@/lib/time/tz";
import { ownerInsightInputSchema } from "@/lib/services/owner-insights";
import { getOwnerInsightsAttendanceAction } from "@/lib/actions/owner-insights";
import { getMembersReport, getStaffReport } from "@/lib/services/owner-people-reports";
import { getOwnerBatchReport } from "@/lib/services/owner-batch-report";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { getEnquiryFunnelAction, getRetentionViewAction, getCoachLoadAction, getFacilityUtilisationAction } from "@/lib/actions/owner-reports";
import { getMoneyAnalyticsAction } from "@/lib/actions/owner-analytics";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ReportPreferenceFilter, ReportPreferencesEmpty } from "@/components/reports/owner-approved/report-preferences";
import type { ReportFamily } from "@/lib/owner-reports/preferences";
import { OverviewAttendance, OverviewTile } from "@/components/reports/owner-approved/overview-cards";
import { EnquiryFunnelCard } from "@/components/reports/enquiry-funnel-card";
import { RetentionCard } from "@/components/reports/retention-card";
import { CoachLoadCard } from "@/components/reports/coach-load-card";
import { UtilisationCard } from "@/components/reports/utilisation-card";
import { PlanRevenueCard } from "@/components/reports/analytics-cards";

type Params = { period?: string; from?: string; to?: string; facility?: string };
export default async function ReportsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.operational");
  const params = searchParams ? await searchParams : {};
  const store = await cookies();
  const invalidFacility = params.facility !== undefined && params.facility !== "all" && !parseFacilityValue(params.facility);
  const facility = resolveFacilityValue(params.facility, store.get(FACILITY_COOKIE)?.value);
  const scope = facility ?? "all";
  const custom = params.from !== undefined || params.to !== undefined;
  const invalidPreset = params.period !== undefined && !isOwnerPeriodKey(params.period);
  const preset = isOwnerPeriodKey(params.period) ? params.period : "last7";
  const window = resolveOwnerPeriod(preset).current;
  const from = custom ? params.from ?? "" : window.fromDate;
  const to = custom ? params.to ?? "" : addDays(window.toDate, 1);
  const parsed = ownerInsightInputSchema.safeParse({ from, to, ...(facility ? { locationId: facility } : {}) });
  const invalid = invalidFacility || invalidPreset || (custom && params.period !== undefined) || !parsed.success;
  const canStaff = hasPermission(ctx, "staff.attendance");
  const canMoney = hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing");
  const available: ReportFamily[] = ["attendance", "members", "batches", ...(canStaff ? ["staff" as const] : []), ...(canMoney ? ["collections" as const] : [])];
  const identity = { tenantId: ctx.tenantId, userId: ctx.userId };
  const scoped = (path: string, extras: Record<string, string> = {}) => `${path}?${new URLSearchParams({ ...extras, facility: scope })}`;
  const heading = <><PageHeader title="Reports" /><div className="mt-4 flex flex-wrap items-end gap-2"><form action="/owner/reports" className="flex items-end gap-2"><input type="hidden" name="facility" value={scope} /><label className="grid gap-1 text-sm text-ink-2">Range<Select name="period" defaultValue={custom ? "" : preset} required>{custom ? <option value="" disabled>Custom range</option> : null}<option value="last7">Last 7 days</option><option value="day">Today</option><option value="week">This week</option><option value="month">This month</option></Select></label><Button type="submit" variant="secondary">Apply</Button></form><Link href={scoped("/owner/settings/reports")} aria-label="Customize reports" title="Customize reports" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-paper text-ink hover:bg-deck"><SlidersHorizontal size={20} aria-hidden="true" /></Link></div></>;
  if (invalid || !hasFeature(ctx, "reports")) return <OwnerPage>{heading}<p role="alert" className="mt-4 text-sm">{invalid ? "Invalid report range or facility. Choose a valid selection." : "Reports are unavailable."}</p></OwnerPage>;
  const detailRange: Record<string, string> = custom ? { from, to: addDays(to, -1) } : { period: preset };
  const range = { from, to: addDays(to, -1), ...(facility ? { locationId: facility } : {}) };
  const [attendance, members, batches, staff, charts, enquiry, retention, coach, utilisation, money, terminology] = await Promise.all([
    settle(() => getOwnerInsightsAttendanceAction(parsed.data)), settle(() => getMembersReport(ctx, range)), settle(() => getOwnerBatchReport(ctx, facility)),
    canStaff ? settle(() => getStaffReport(ctx, range)) : null,
    canMoney && !custom ? settle(() => getOwnerCharts(ctx, { period: preset, ...(facility ? { locationId: facility } : {}) })) : null,
    !facility ? settle(() => getEnquiryFunnelAction({ from, to })) : null,
    !facility ? settle(() => getRetentionViewAction()) : null,
    !facility ? settle(() => getCoachLoadAction({ from, to })) : null,
    settle(() => getFacilityUtilisationAction(facility ? { locationId: facility } : {})),
    canMoney ? settle(() => getMoneyAnalyticsAction({ from, to }, facility)) : null,
    getTerminologyAction(),
  ]);
  const memberLabel = titleCase(resolveTerm(terminology, "member", "other"));
  const batchLabel = titleCase(resolveTerm(terminology, "batch", "other"));
  return <OwnerPage>{heading}
    <p className="mt-3 text-sm text-ink-2">{formatPeriodRangeIST(from, to)}{facility ? " · Selected facility" : " · All permitted facilities"}</p>
    <Link href={scoped("/owner/settings/reports")} className="block empty:hidden"><ReportPreferencesEmpty identity={identity} available={available} /></Link>
    <div className="mt-4 empty:hidden"><ReportPreferenceFilter identity={identity} available={available} family="attendance"><OverviewAttendance data={attendance} href={scoped("/owner/reports/attendance", detailRange)} /></ReportPreferenceFilter></div>
    <div className="mt-3 grid grid-cols-2 gap-3 empty:hidden lg:grid-cols-4">
      <ReportPreferenceFilter identity={identity} available={available} family="members"><OverviewTile icon="members" title={memberLabel} value={members ? String(members.statuses.find(row => row.status === "active")?.count ?? 0) : null} detail={members ? `${members.joined} joined in range · active now` : undefined} href={custom ? undefined : scoped("/owner/reports/members", { period: preset })} tone="info" /></ReportPreferenceFilter>
      <ReportPreferenceFilter identity={identity} available={available} family="staff"><OverviewTile icon="staff" title="Staff check-ins" value={staff ? String(staff.attendance.filter(row => row.checkedIn).length) : null} detail="Recorded check-ins" href={custom ? undefined : scoped("/owner/reports/staff", { period: preset })} tone="butter" /></ReportPreferenceFilter>
      <ReportPreferenceFilter identity={identity} available={available} family="batches"><OverviewTile icon="batches" title={`${batchLabel} places`} value={batches ? String(batches.reduce((sum, row) => sum + row.reservedPlaces, 0)) : null} detail={batches ? `Reserved of ${batches.reduce((sum, row) => sum + row.capacity, 0)} places · current` : undefined} href={scoped("/owner/reports/batches")} tone="money" /></ReportPreferenceFilter>
      <ReportPreferenceFilter identity={identity} available={available} family="collections"><OverviewTile icon="payments" title="Payments recorded" value={charts ? String(charts.collections.paymentCount) : null} detail={custom ? "Unavailable for custom range" : "Captured payments"} href={custom ? undefined : scoped("/owner/reports/collections", { view: "trends", period: preset })} tone="info" /></ReportPreferenceFilter>
    </div>
    <details className="mt-5"><summary className="min-h-11 cursor-pointer text-sm font-semibold">More reports</summary><div className="grid items-start gap-3 lg:grid-cols-2">
      {facility ? <p className="text-sm text-ink-2">Some reports are unavailable for a selected facility.</p> : <>{enquiry ? <EnquiryFunnelCard rows={enquiry} /> : <p>Enquiry report unavailable.</p>}{retention ? <RetentionCard report={retention} memberLabel={resolveTerm(terminology, "member", "other")} memberLabelOne={resolveTerm(terminology, "member", 1)} /> : <p>Attendance records unavailable.</p>}{coach ? <CoachLoadCard rows={coach} /> : <p>Coach load unavailable.</p>}</>}
      {utilisation ? <UtilisationCard report={utilisation} /> : <p>Utilisation unavailable.</p>}
      {canMoney ? money ? <PlanRevenueCard rows={money.planRevenue} /> : <p>Plan revenue unavailable.</p> : null}
    </div></details>
  </OwnerPage>;
}

async function settle<T>(fn: () => Promise<T>): Promise<T | null> { try { return await fn(); } catch { return null; } }
