import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { getOwnerChartsAction } from "@/lib/actions/owner-home-charts";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { OwnerDashboard } from "@/components/owner-dashboard";
import { requireOwner } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";

// W1-6 continuation — the landing page now honours the facility
// switcher end-to-end: the URL wins, the remembered cookie is the
// fallback, and both the dashboard figures and the trend series are
// scoped by the same value. Charts cover the last 30 days; a failure
// in either analytics read (e.g. a role without financial permission)
// degrades to "no chart" rather than breaking the page.
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

  const [data, branding, terminology, checklist, chartsData] = await Promise.all([
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
  ]);

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
    />
  );
}
