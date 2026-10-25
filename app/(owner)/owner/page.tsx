import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOwnerDashboardAction } from "@/lib/actions/dashboard";
import { getBrandingAction } from "@/lib/actions/branding";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import {
  getMoneyAnalyticsAction,
  getOperationalAnalyticsAction,
} from "@/lib/actions/owner-analytics";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { addDays, todayInZone } from "@/lib/time/tz";
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
  searchParams?: Promise<{ facility?: string }>;
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

  const timezone = await getTenantTimezoneAction();
  const today = todayInZone(timezone);
  const trendPeriod = { from: addDays(today, -29), to: addDays(today, 1) };

  const [data, branding, terminology, checklist, operational, money] = await Promise.all([
    getOwnerDashboardAction(facility ? { facility } : undefined),
    getBrandingAction(),
    getTerminologyAction(),
    getOnboardingChecklistAction().catch(() => null),
    getOperationalAnalyticsAction(trendPeriod, facility).catch(() => null),
    getMoneyAnalyticsAction(trendPeriod, facility).catch(() => null),
  ]);

  // The everyday actions the Today screen puts first. Each one is
  // gated by the same permission the destination itself enforces, so
  // the screen never offers an action the caller would be refused.
  const can = {
    addMember: hasPermission(ctx, "members.write"),
    recordPayment: hasPermission(ctx, "payments.record"),
    captureEnquiry: hasPermission(ctx, "enquiries.write"),
  };

  return (
    <OwnerDashboard
      data={data}
      branding={branding}
      terminology={terminology}
      showOnboarding={checklist ? checklist.items.some((item) => !item.complete) : false}
      can={can}
      charts={{
        attendance: operational?.attendanceTrend ?? null,
        collections: money?.collections ?? null,
      }}
    />
  );
}
