import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { getOwnerChartsAction } from "@/lib/actions/owner-home-charts";
import {
  getOwnerInsightsAttendanceAction,
  getOwnerInsightsEnquiryStagesAction,
} from "@/lib/actions/owner-insights";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { insightWindow } from "@/components/owner-insights-home/insight-window";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";

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
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const facility = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );

  const trend = params.trend === "attendance" ? "attendance" : "collections";
  const period =
    params.period === "week" || params.period === "month" ? params.period : "day";

  const [data, branding, terminology, checklist, chartsData, timezone] =
    await Promise.all([
      getOwnerDashboardAction(facility ? { facility } : undefined),
      getBrandingAction(),
      getTerminologyAction(),
      getOnboardingChecklistAction().catch(() => null),
      // The chart band degrades to a stated "unavailable" panel rather
      // than taking the page down with it.
      getOwnerChartsAction({
        period,
        ...(facility ? { facility } : {}),
      }).catch(() => null),
      // The insights window is printed in the tenant's own timezone. A
      // read that fails here would only cost the label, so it falls
      // back to the display zone the rest of the page uses.
      getTenantTimezoneAction().catch(() => "Asia/Kolkata"),
    ]);

  // The insights read models (attendance by batch, enquiries by
  // current stage). The window is the last 30 club days ending today,
  // and the SELECTED FACILITY is passed as the location scope, so the
  // numbers under a narrow filter are the narrow numbers — the read
  // models can only narrow, never widen.
  //
  // A caller without the operational-reports grant never reaches a
  // read: the section is absent, not empty, so it cannot reveal that
  // the data exists. A read that FAILS is a different thing from an
  // empty result, and it degrades to a stated "could not be read".
  const canReadInsights = hasPermission(ctx, "reports.operational");
  const insightWindowRange = insightWindow(data.today);
  const insightInput = {
    ...insightWindowRange,
    ...(facility ? { locationId: facility } : {}),
  };
  const [attendanceInsight, enquiryInsight] = canReadInsights
    ? await Promise.all([
        getOwnerInsightsAttendanceAction(insightInput).catch(() => null),
        getOwnerInsightsEnquiryStagesAction(insightInput).catch(() => null),
      ])
    : [null, null];

  // The everyday actions the Today screen puts first. Each one is
  // gated by the same permission the destination itself enforces, so
  // the screen never offers an action the caller would be refused.
  const can = {
    addMember: hasPermission(ctx, "members.write"),
    recordPayment: hasPermission(ctx, "payments.record"),
    captureEnquiry: hasPermission(ctx, "enquiries.write"),
    readFees:
      hasPermission(ctx, "reports.financial") && hasPermission(ctx, "invoices.read"),
    viewSchedule: hasPermission(ctx, "attendance.read"),
    // The enquiries LIST is a separate destination from the insights
    // read, and it enforces its own permission.
    readEnquiries: hasPermission(ctx, "enquiries.read"),
  };
  // Onboarding is for an academy that has not started yet — not a
  // standing nag for one unfinished checklist item.
  const isNewAcademy = checklist !== null && checklist.completedCount === 0;

  return (
    <OwnerDashboard
      data={data}
      branding={branding}
      terminology={terminology}
      showOnboarding={isNewAcademy}
      can={can}
      trend={trend}
      facility={facility}
      chartsData={chartsData}
      // The seed for the small club artwork. The tenant id makes the
      // picture stable for the visit: a re-render or a hydration pass
      // never swaps the art under the owner.
      illustrationSeed={ctx.tenantId}
      insights={
        canReadInsights
          ? {
              ...insightWindowRange,
              timezone,
              attendance: attendanceInsight,
              enquiries: enquiryInsight,
            }
          : null
      }
    />
  );
}
