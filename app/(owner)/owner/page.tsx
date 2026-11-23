import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { Suspense } from "react";
import { resolvePresetScope } from "@/db/preset-engine";
import { withTenant } from "@/db/tenant";
import { OwnerStageScope } from "@/components/owner-home/owner-facility-scope";
import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { getOwnerChartsAction } from "@/lib/actions/owner-home-charts";
import { FACILITY_COOKIE, resolveRequestedFacility } from "@/lib/facility";
import { canSelectFacility } from "@/lib/services/selected-facility-access";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { ManagementBrief } from "@/components/owner-home/management-brief";
import { OwnerBriefHome } from "@/components/owner-home/owner-brief/owner-brief-home";
import {
  buildOwnerHomeBriefView,
  listOwnerBriefFacilities,
} from "@/lib/services/owner-home-brief";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { guidePreferenceKey } from "@/components/onboarding/guide-preference-key";
import { OwnerLink } from "@/components/owner-ui/owner-link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { hasBookingEntitlement } from "@/lib/auth/booking-entitlement";

async function unavailableFacility(destination: string) {
  const terminology = ownerTerminology(await getTerminologyAction());
  const facility = resolveTerm(terminology, "facility", 1);
  return (
    <OwnerPage>
      <h1 className="font-display text-xl font-semibold">{titleCase(facility)} unavailable</h1>
      <p className="mt-2 text-sm text-ink-2">This {facility} is unavailable for your account.</p>
      <OwnerLink href={`${destination}?facility=all`} className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--accent-ink)] underline">
        View available {resolveTerm(terminology, "facility", "other")}
      </OwnerLink>
    </OwnerPage>
  );
}

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
  const params = searchParams ? await searchParams : {};
  // Pick only a destination whose own read grants and entitlements are held.
  // An explicit URL scope remains an untrusted filter and is checked here.
  if (!hasPermission(ctx, "dashboard.view")) {
    // Fees and Schedule use page-authorized tenant timezone reads after Operations integration.
    const destination = hasPermission(ctx, "reports.financial") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing")
      ? "/owner/fees"
      : hasPermission(ctx, "attendance.read") ? "/owner/schedule"
        : hasPermission(ctx, "programs.read") ? "/owner/programs"
          : hasPermission(ctx, "members.read") ? "/owner/members" : null;
    if (destination) {
      const scope = resolveRequestedFacility({ facility: params.facility });
      if (!scope.valid || (scope.facilityId && !(await canSelectFacility(ctx, scope.facilityId)))) {
        return unavailableFacility(destination);
      }
      const query = params.facility === undefined ? "" : `?${new URLSearchParams({ facility: params.facility })}`;
      redirect(`${destination}${query}`);
    }
    return <OwnerPage><h1 className="font-display text-xl font-semibold">No workspace access</h1><p className="mt-2 text-sm text-ink-2">Ask your club owner to review your access.</p></OwnerPage>;
  }
  if (!hasFeature(ctx, "reports")) {
    return (
      <OwnerPage>
        <div className="mb-4 max-w-56"><Suspense fallback={null}><OwnerStageScope /></Suspense></div>
        <h1 className="text-2xl font-semibold text-ink">Overview unavailable</h1>
        <p className="mt-2 text-ink-3">Reports are not available for this club.</p>
        <OptionalWorkspaceGuide
          key={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
          startCollapsed
          preferenceKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
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
  const cookieStore = await cookies();
  const { valid, facilityId: facility } = resolveRequestedFacility({
    facility: params.facility,
    cookie: cookieStore.get(FACILITY_COOKIE)?.value,
  });
  if (!valid || (facility && !(await canSelectFacility(ctx, facility)))) {
    return unavailableFacility("/owner");
  }

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
      getTerminologyAction().then(ownerTerminology),
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
    bookCourt: hasPermission(ctx, "bookings.read") && hasPermission(ctx, "bookings.write") && hasBookingEntitlement(ctx.features),
    // The trend drill-down beside the collections figure.
    viewTrend: canViewTrends,
  };
  // Onboarding is for an academy that has not started yet — not a
  // standing nag for one unfinished checklist item.
  const isNewAcademy = checklist !== null && !checklist.scopeIsLimited &&
    checklist.totalCount === 3 && checklist.items.length === 3 &&
    ["add_members", "create_batch", "assign_coach"].every((key) => checklist.items.some((item) => item.key === key)) &&
    checklist.completedCount === 0;
  const preset = await withTenant(ctx.tenantId, tx =>
    resolvePresetScope(tx, ctx.tenantId, data.scopeLocationName ? facility ?? undefined : undefined),
  ).catch(() => null);
  const sport: "pool" | "court" = preset?.startsWith("swimming@") ? "pool" : "court";

  // Owners retain the interactive financial brief. Managers and administrators
  // use the same presentation primitives with operational work first.
  if (ctx.roleKey === "owner" || ctx.roleKey === "manager" || ctx.roleKey === "admin") {
    const facilities = await listOwnerBriefFacilities(ctx);
    const brief = buildOwnerHomeBriefView({
      data,
      charts: chartsData,
      facilities,
      branding,
      requestedFacility: facility ?? null,
      can: {
        fees: can.readFees && hasFeature(ctx, "billing"),
        schedule: can.viewSchedule,
        enquiries: can.readEnquiries,
      },
    });
    if (ctx.roleKey !== "owner") {
      return (
        <OwnerPage data-testid="owner-home" data-management-brief className="brief-page">
          <ManagementBrief brief={brief} sport={sport} attention={data.needsAttention} />
        </OwnerPage>
      );
    }
    return (
      <OwnerPage
        data-testid="owner-home"
        data-brief-owner=""
        className="brief-page"
      >
        <OwnerBriefHome initialView={brief} sport={sport} facilityNoun={resolveTerm(terminology, "facility", 1)} />
        {isNewAcademy ? (
          <OwnerLink
            href="/owner/onboarding"
            className="mt-4 inline-flex min-h-11 items-center rounded-ctl border border-line bg-paper px-4 text-sm font-medium text-ink hover:bg-deck"
          >
            Set up your club
          </OwnerLink>
        ) : null}
        <OptionalWorkspaceGuide
          key={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
          startCollapsed
          preferenceKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
          title="A look around today"
          intro="Explore the brief at your own pace. This guide makes no changes."
          regionLabel="Optional daily overview guide"
          itemLabel="Overview area"
          items={[
            { key: "money", title: "Money", detail: "Recorded payments and the current outstanding balance." },
            { key: "today", title: "Club today", detail: "The next session and overdue enquiry follow-ups." },
            ...(isNewAcademy ? [{ key: "setup", title: "Set up your club", detail: "Finish the available register checks." }] : []),
          ]}
        />
      </OwnerPage>
    );
  }

  return (
    <OwnerDashboard
      data={data}
      branding={branding}
      terminology={terminology}
      showOnboarding={isNewAcademy}
      can={can}
      period={period}
      facility={facility}
      chartsData={chartsData}
      floodlitSport={sport}
      guideKey={guidePreferenceKey(ctx.tenantId, ctx.userId, ctx.roleKey)}
    />
  );
}
