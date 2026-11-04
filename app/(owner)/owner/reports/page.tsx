import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { cookies } from "next/headers";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { FACILITY_COOKIE, parseFacilityValue, resolveFacilityValue } from "@/lib/facility";
import { isOwnerPeriodKey, resolveOwnerPeriod } from "@/lib/time/owner-periods";
import { addDays, formatPeriodRangeIST } from "@/lib/time/tz";
import { ownerInsightInputSchema } from "@/lib/services/owner-insights";
import { getEnquiryFunnelAction, getRetentionViewAction, getCoachLoadAction, getFacilityUtilisationAction } from "@/lib/actions/owner-reports";
import { getMoneyAnalyticsAction } from "@/lib/actions/owner-analytics";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";
import { ReportPreferenceFilter, ReportPreferencesEmpty } from "@/components/reports/owner-approved/report-preferences";
import type { ReportFamily } from "@/lib/owner-reports/preferences";
import { EnquiryFunnelCard } from "@/components/reports/enquiry-funnel-card";
import { RetentionCard } from "@/components/reports/retention-card";
import { CoachLoadCard } from "@/components/reports/coach-load-card";
import { UtilisationCard } from "@/components/reports/utilisation-card";
import { PlanRevenueCard } from "@/components/reports/analytics-cards";

// C-34/U-01 — the owner REPORTS INDEX.
//
// 2 November 2026 (REPORTS-COMPOSITION-ADDENDUM): the approved mock's
// viewReports() is a concise REPORT DIRECTORY — a list of purposeful
// destinations, each with one line of purpose — not a second dashboard
// of headline figures. The old index repeated the Attendance / Members /
// Staff / Places / Payments tiles, and every one of those figures already
// has a home in the detailed report it belongs to. Repeating them is what
// the human rejected.
//
// So this page is a directory:
//
//   * one named destination per supported report family, each linking to
//     the detailed report that owns the figures, charts and method;
//   * the family's permission, feature entitlement, facility scope and
//     the operator's own report-visibility preference all still decide
//     whether that destination is offered;
//   * the supplementary reports (Enquiries, Attendance records to review,
//     Coach load, Utilisation, Plan revenue) stay reachable in the concise
//     "More reports" disclosure — they are their own reports, not a second
//     copy of the directory;
//   * the legacy ?period= / ?from= / ?to= deep links still work: a period
//     preset is carried into the destinations that accept one, and a custom
//     range is carried only into the destinations whose filter shape
//     actually supports it (never an unsupported filter shape).

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
  const heading = (
    <PageHeader
      title="Reports"
      action={
        <Link href={scoped("/owner/settings/reports")} aria-label="Customize reports" title="Customize reports" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-line bg-paper text-ink hover:bg-deck">
          {/* The approved mock has no sliders glyph for this control, so
              the shared `settings` outline is used and documented here
              rather than substituting unrelated imagery: the control
              opens the report SETTINGS page. */}
          <OwnerIcon name="settings" size={20} />
        </Link>
      }
    />
  );
  if (invalid || !hasFeature(ctx, "reports")) return <OwnerPage>{heading}<p role="alert" className="mt-4 text-sm">{invalid ? "Invalid report range or facility. Choose a valid selection." : "Reports are unavailable."}</p></OwnerPage>;
  const terminology = await getTerminologyAction();
  const memberLabel = titleCase(resolveTerm(terminology, "member", "other"));
  const batchLabel = titleCase(resolveTerm(terminology, "batch", "other"));
  // A custom range reaches only the destinations whose own filter accepts
  // one. The others say so plainly instead of silently opening on a
  // different window.
  const customNote = "Unavailable for custom range";
  const periodRange = { period: preset };
  const CATEGORY_ICON: Record<ReportFamily, OwnerIconName> = {
    collections: "money",
    members: "members",
    staff: "staff",
    batches: "programs",
    attendance: "calendar",
  };
  const rows: Array<{
    family: ReportFamily;
    title: string;
    purpose: string;
    href: string | null;
    note?: string;
  }> = [];
  if (canMoney) {
    rows.push({
      family: "collections",
      title: "Collections",
      purpose: "Trends and payment methods",
      href: custom ? null : scoped("/owner/reports/collections", { view: "trends", ...periodRange }),
      note: custom ? customNote : undefined,
    });
  }
  rows.push({
    family: "members",
    title: memberLabel,
    purpose: "New joins and current status",
    href: custom ? null : scoped("/owner/reports/members", periodRange),
    note: custom ? customNote : undefined,
  });
  if (canStaff) {
    rows.push({
      family: "staff",
      title: "Staff",
      purpose: "Check-ins, shifts and recorded statuses",
      href: custom ? null : scoped("/owner/reports/staff", periodRange),
      note: custom ? customNote : undefined,
    });
  }
  rows.push({
    family: "batches",
    title: batchLabel,
    purpose: "Reserved places and capacity",
    // The batches report has no date dimension: it reports the CURRENT
    // reserved places, so it stays reachable under a custom range.
    href: scoped("/owner/reports/batches"),
  });
  rows.push({
    family: "attendance",
    title: "Attendance",
    purpose: "Recorded attendance and register completion",
    href: scoped("/owner/reports/attendance", custom ? { from, to: addDays(to, -1) } : periodRange),
  });
  const [enquiry, retention, coach, utilisation, money] = await Promise.all([
    !facility ? settle(() => getEnquiryFunnelAction({ from, to })) : null,
    !facility ? settle(() => getRetentionViewAction()) : null,
    !facility ? settle(() => getCoachLoadAction({ from, to })) : null,
    settle(() => getFacilityUtilisationAction(facility ? { locationId: facility } : {})),
    canMoney ? settle(() => getMoneyAnalyticsAction({ from, to }, facility)) : null,
  ]);
  return <OwnerPage>{heading}
    <p className="mt-3 text-sm text-ink-2">{formatPeriodRangeIST(from, to)}{facility ? " · Selected facility" : " · All permitted facilities"}</p>
    <Link href={scoped("/owner/settings/reports")} className="block empty:hidden"><ReportPreferencesEmpty identity={identity} available={available} /></Link>
    {/* empty:hidden — when every family is hidden by the operator's report
        visibility preference the recovery notice appears and this list has no
        children, so it must not paint an empty bordered card then
        (confirmed in production Chrome: a 358x2px bordered box). */}
    {/* Category cards, one per supported report family. empty:hidden keeps the
        confirmed 358x2px empty-card defect from returning when every family is
        hidden by the operator's report-visibility preference. */}
    <div data-testid="report-categories" className="mt-4 grid grid-cols-2 gap-3 max-[339px]:grid-cols-1 lg:grid-cols-3 empty:hidden">
      {rows.map((row) => (
        <ReportPreferenceFilter key={row.family} identity={identity} available={available} family={row.family}>
          {row.href ? (
            <Link href={row.href} data-testid="report-card" data-family={row.family} aria-label={`${row.title} report`} className="group flex min-h-24 min-w-0 flex-col justify-between rounded-card border border-line bg-paper p-3 hover:bg-deck focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus,var(--accent-strong))]">
              <span className="flex items-start justify-between gap-2">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-deck text-ink-2"><OwnerIcon name={CATEGORY_ICON[row.family]} size={20} /></span>
                <OwnerIcon name="chevron" size={18} className="mt-1 flex-none text-ink-3" />
              </span>
              <span className="mt-2 block min-w-0">
                <span className="block break-words text-[14px] font-medium leading-snug text-ink">{row.title}</span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-ink-3">{row.purpose}</span>
              </span>
            </Link>
          ) : (
            <div data-testid="report-card" data-family={row.family} aria-label={`${row.title} report`} className="flex min-h-24 min-w-0 flex-col justify-between rounded-card border border-dashed border-line bg-paper p-3">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-deck text-ink-3"><OwnerIcon name={CATEGORY_ICON[row.family]} size={20} /></span>
              <span className="mt-2 block min-w-0">
                <span className="block break-words text-[14px] font-medium leading-snug text-ink-2">{row.title}</span>
                <span className="mt-0.5 block break-words text-[12px] leading-snug text-ink-3">{row.note ?? row.purpose}</span>
              </span>
            </div>
          )}
        </ReportPreferenceFilter>
      ))}
    </div>
    <details className="mt-5"><summary className="min-h-11 cursor-pointer text-sm font-semibold">More reports</summary><div className="grid items-start gap-3 lg:grid-cols-2">
      {facility ? <p className="text-sm text-ink-2">Some reports are unavailable for a selected facility.</p> : <>{enquiry ? <EnquiryFunnelCard rows={enquiry} /> : <p>Enquiry report unavailable.</p>}{retention ? <RetentionCard report={retention} memberLabel={resolveTerm(terminology, "member", "other")} memberLabelOne={resolveTerm(terminology, "member", 1)} /> : <p>Attendance records unavailable.</p>}{coach ? <CoachLoadCard rows={coach} /> : <p>Coach load unavailable.</p>}</>}
      {utilisation ? <UtilisationCard report={utilisation} /> : <p>Utilisation unavailable.</p>}
      {canMoney ? money ? <PlanRevenueCard rows={money.planRevenue} /> : <p>Plan revenue unavailable.</p> : null}
    </div></details>
  </OwnerPage>;
}

async function settle<T>(fn: () => Promise<T>): Promise<T | null> { try { return await fn(); } catch { return null; } }
