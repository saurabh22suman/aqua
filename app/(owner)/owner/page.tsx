import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { getOwnerChartsAction } from "@/lib/actions/owner-home-charts";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";

// W1-6 continuation — the landing page now honours the facility
// switcher end-to-end: the URL wins, the remembered cookie is the
// fallback, and both the dashboard figures and the trend series are
// scoped by the same value. Charts cover the last 30 days; a failure
// in either analytics read (e.g. a role without financial permission)
// degrades to "no chart" rather than breaking the page.
//
// The insights section below the chart band reads the two owner-insight
// read models over the last 30 club days, scoped to the same facility
// value, and is absent for a caller without the operational-reports
// grant.
export default async function OwnerHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string; trend?: string; period?: string }>;
}) {
  const ctx = await requireOwner();
  // C01 (docs/audits/2026-10-09-role-content-permission-audit.md §9) —
  // the Accountant is routed to /owner but holds no dashboard.view, so
  // the dashboard action would refuse them. Their home is the financial
  // entry instead; Owner/Admin keep the dashboard unchanged.
  if (!hasPermission(ctx, "dashboard.view")) {
    redirect("/owner/fees");
  }
  if (!hasFeature(ctx, "reports")) {
    return (
      <OwnerPage>
        <h1 className="text-2xl font-semibold text-ink">Overview unavailable</h1>
        <p className="mt-2 text-ink-3">Reports are not available for this club.</p>
        <OptionalWorkspaceGuide
          startCollapsed
          title="About this overview"
          intro="This guide makes no changes."
          regionLabel="Optional unavailable overview guide"
          itemLabel="Overview area"
          items={[
            { key: "unavailable", title: "Overview unavailable", detail: "Reports are not available for this club." },
            ...(hasPermission(ctx, "members.read") && hasFeature(ctx, "members") ? [{ key: "members", title: "Members", detail: "The members link is available on this page." }] : []),
          ]}
        />
        {hasPermission(ctx, "members.read") && hasFeature(ctx, "members") ? (
          <OwnerLink href="/owner/members" className="mt-4 inline-block text-accent underline underline-offset-2">
            View members
          </OwnerLink>
        ) : null}
      </OwnerPage>
    );
  }
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );

  // The dashboard trend band defaults to a genuine Last 7 days window
  // (today and the preceding six IST calendar dates). Day and Month
  // remain available as the shorter and longer ranges; the
  // Monday-to-now "week" window is still accepted for compatibility
  // with existing links, but it is not offered as a button beside
  // "Last 7 days". A legacy `trend=` parameter is accepted and
  // ignored: the band no longer switches between two metrics.
  const period = "last7";
  const canReadFees = hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read");
  // The collections TREND report enforces its own gates: the
  // reports.financial page grant, invoices.read and the reports and
  // billing entitlements. The Home offers "View trend" only when every
  // one of them is held, so the link never opens a destination that
  // would refuse the caller.
  const canViewTrends =
    canReadFees && hasFeature(ctx, "reports") && hasFeature(ctx, "billing");

  const [data, branding, terminology, checklist, chartsData] =
    await Promise.all([
      getOwnerDashboardAction(facility ? { facility } : undefined),
      getBrandingAction(),
      getTerminologyAction(),
      getOnboardingChecklistAction().catch(() => null),
      // The chart band degrades to a stated "unavailable" panel rather
      // than taking the page down with it.
      canReadFees ? getOwnerChartsAction({
        period,
        ...(facility ? { facility } : {}),
      }).catch(() => null) : Promise.resolve(null),
    ]);

  // The everyday actions the Today screen puts first. Each one is
  // gated by the same permission the destination itself enforces, so
  // the screen never offers an action the caller would be refused.
  const can = {
    addMember: hasPermission(ctx, "members.write"),
    recordPayment: hasPermission(ctx, "payments.record"),
    captureEnquiry: hasPermission(ctx, "enquiries.write"),
    readFees: canReadFees,
    viewSchedule: hasPermission(ctx, "attendance.read"),
    // The enquiries LIST is a separate destination from the insights
    // read, and it enforces its own permission.
    readEnquiries: hasPermission(ctx, "enquiries.read"),
    // The programs board and the staff directory enforce their own
    // permissions on their own pages, and the desktop sidebar filters
    // those same destinations by the same keys. The phone shortcuts
    // read the same keys, so a shortcut never offers a destination
    // that would refuse the caller.
    readPrograms: hasPermission(ctx, "programs.read"),
    readStaff: hasPermission(ctx, "staff.read"),
    readMembers: hasPermission(ctx, "members.read"),
    bookCourt: hasPermission(ctx, "bookings.read") && hasPermission(ctx, "bookings.write") && ctx.features.has("pool.booking"),
    // The trend drill-down beside the collections figure.
    viewTrend: canViewTrends,
  };
  // Onboarding is for an academy that has not started yet — not a
  // standing nag for one unfinished checklist item.
  const isNewAcademy = checklist !== null && !checklist.scopeIsLimited &&
    checklist.totalCount === 3 && checklist.items.length === 3 &&
    ["add_members", "create_batch", "assign_coach"].every((key) => checklist.items.some((item) => item.key === key)) &&
    checklist.completedCount === 0;
  return (
    <OwnerDashboard
      data={data}
      branding={branding}
      terminology={terminology}
      showOnboarding={isNewAcademy}
      can={can}
      period={period}
      facility={facility}
      artworkIdentity={{ tenantId: ctx.tenantId, userId: ctx.userId }}
      chartsData={chartsData}
      // The seed for the small club artwork. The tenant id makes the
      // picture stable for the visit: a re-render or a hydration pass
      // never swaps the art under the owner.
      illustrationSeed={ctx.tenantId}

    />
  );
}
