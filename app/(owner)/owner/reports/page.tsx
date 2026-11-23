import { ownerTerminology } from "@/lib/terminology/owner-terms";
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

const reportGroups: ReadonlyArray<{ id: string; title: string; families: readonly ReportFamily[] }> = [
  { id: "financial-reports", title: "Money", families: ["collections"] },
  { id: "operations-reports", title: "Club operations", families: ["members", "staff", "batches", "attendance"] },
];

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
  const reportsEnabled = hasFeature(ctx, "reports");
  const canStaff = hasPermission(ctx, "staff.attendance");
  const canMoney = hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing");
  const available: ReportFamily[] = ["attendance", "members", "batches", ...(canStaff ? ["staff" as const] : []), ...(canMoney ? ["collections" as const] : [])];
  const identity = { tenantId: ctx.tenantId, userId: ctx.userId };
  const scoped = (path: string, extras: Record<string, string> = {}) => `${path}?${new URLSearchParams({ ...extras, facility: scope })}`;
  const heading = (
    <PageHeader
      title="Reports"
      action={reportsEnabled ? (
        <Link
          href={scoped("/owner/settings/reports")}
          className="inline-flex min-h-11 items-center gap-2 rounded-ctl border border-line bg-paper px-3 text-sm font-medium text-ink hover:bg-deck"
        >
          <OwnerIcon name="settings" size={16} />
          Report preferences
        </Link>
      ) : null}
    />
  );
  if (invalid) return <OwnerPage workflow="directory">{heading}<p role="alert" className="mt-4 text-sm">Invalid report range or facility. Choose a valid selection.</p><Link href={`/owner/reports?${new URLSearchParams({ period: "last7", facility: invalidFacility ? "all" : params.facility ?? facility ?? "all" })}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-[var(--accent-ink)] underline underline-offset-2">Start again</Link></OwnerPage>;
  if (!reportsEnabled) return <OwnerPage workflow="directory">{heading}<p role="alert" className="mt-4 text-sm">Reports are unavailable.</p></OwnerPage>;
  const terminology = await getTerminologyAction().then(ownerTerminology);
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
  return <OwnerPage workflow="directory" data-owner-money-page="reports">{heading}
    <p className="mt-3 text-sm text-ink-2">{formatPeriodRangeIST(from, to)}{facility ? " · Selected facility" : " · All permitted facilities"}</p>
    {custom ? <p className="mt-1 text-sm text-ink-2">Some report cards need a standard range. <Link href={scoped("/owner/reports", { period: "last7" })} className="inline-flex min-h-11 items-center font-medium text-[var(--accent-ink)] underline underline-offset-2">Use Last 7 days</Link></p> : null}
    <Link href={scoped("/owner/settings/reports")} className="block empty:hidden"><ReportPreferencesEmpty identity={identity} available={available} /></Link>
    <div data-testid="report-categories" className="owner-report-directory">
      {reportGroups.map(group => (
        <section key={group.title} className="owner-report-group" aria-labelledby={group.id}>
          <h2 id={group.id}>{group.title}</h2>
          <div className="owner-report-links">
            {rows.filter(row => group.families.includes(row.family)).map((row) => (
              <ReportPreferenceFilter key={row.family} identity={identity} available={available} family={row.family}>
                {row.href ? (
                  <Link href={row.href} data-testid="report-card" data-family={row.family} aria-label={`${row.title} report`} className="owner-report-destination">
                    <span className="owner-report-glyph"><OwnerIcon name={CATEGORY_ICON[row.family]} size={20} /></span>
                    <span className="block min-w-0">
                      <span className="block break-words text-[14px] font-medium leading-snug text-ink">{row.title}</span>
                      <span className="mt-0.5 block break-words text-[12px] leading-snug text-ink-3">{row.purpose}</span>
                    </span>
                    <OwnerIcon name="chevron" size={18} className="ml-auto flex-none text-ink-3" />
                  </Link>
                ) : (
                  <div data-testid="report-card" data-family={row.family} aria-label={`${row.title} report`} className="owner-report-destination is-unavailable">
                    <span className="owner-report-glyph"><OwnerIcon name={CATEGORY_ICON[row.family]} size={20} /></span>
                    <span className="block min-w-0">
                      <span className="block break-words text-[14px] font-medium leading-snug text-ink-2">{row.title}</span>
                      <span className="mt-0.5 block break-words text-[12px] leading-snug text-ink-3">{row.note ?? row.purpose}</span>
                    </span>
                  </div>
                )}
              </ReportPreferenceFilter>
            ))}
          </div>
        </section>
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
