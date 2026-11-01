import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listLocations } from "@/lib/services/people";
import { resolveLocationAccess } from "@/lib/services/location-access";
import { withTenant } from "@/db/tenant";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { todayInZone } from "@/lib/time/tz";
import { CollectionsReport } from "@/components/reports/collections-report";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { cookies } from "next/headers";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { isOwnerPeriodKey } from "@/lib/time/owner-periods";
import { CollectionsTrends } from "@/components/reports/owner-approved/collections-trends";
import { CollectionsViews } from "@/components/reports/owner-approved/collections-views";

// C-34 — daily collections: what came in, by method and by the person
// who took it, with the cash count confirmation. Accountant-grade
// (reports.financial gates the read at the action layer); confirming
// is a counter action (payments.record).

export default async function CollectionsPage({ searchParams }: { searchParams?: Promise<{ view?: string; period?: string; facility?: string }> }) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "reports.financial");
  const params = searchParams ? await searchParams : {};
  if (params.view === "trends") {
    const cookieStore = await cookies();
    const facility = resolveFacilityValue(params.facility, cookieStore.get(FACILITY_COOKIE)?.value);
    const facilityScope = params.facility === "all" ? "all" : facility;
    const period = isOwnerPeriodKey(params.period) ? params.period : "last7";
    const validPeriod = params.period === undefined || isOwnerPeriodKey(params.period);
    const permitted = hasPermission(ctx, "invoices.read") && hasFeature(ctx, "reports") && hasFeature(ctx, "billing");
    let data = null;
    let failed = false;
    if (permitted && validPeriod) {
      try { data = await getOwnerCharts(ctx, { period, ...(facility ? { locationId: facility } : {}) }); }
      catch { failed = true; }
    }
    return <OwnerPage>
      <BackLink href={`/owner/reports?${new URLSearchParams({ facility: facility ?? "all" })}`} label="All reports" />
      <PageHeader title="Collections report" />
      <CollectionsViews view="trends" facility={facility} period={period} />
      {!validPeriod ? <p role="alert" className="mt-4 text-sm text-ink-2">Invalid range. Choose a valid range.</p> : !permitted ? <p className="mt-4 text-sm text-ink-2">Trends unavailable for your access.</p> : failed ? <p role="alert" className="mt-4 text-sm text-ink-2">Collections could not load. Please try again.</p> : data ? <CollectionsTrends data={data} facility={facility} facilityScope={facilityScope} /> : null}
    </OwnerPage>;
  }
  const [allLocations, access, timezone, terminology, cookieStore] = await Promise.all([
    listLocations(ctx),
    withTenant(ctx.tenantId, tx => resolveLocationAccess(tx, ctx)),
    withTenant(ctx.tenantId, tx => tenantTimezoneInTx(tx, ctx.tenantId)),
    // Fetched here so the report's facility label follows the tenant's
    // vocabulary (L3 audit rule: no hardcoded vocab in JSX text).
    getTerminologyAction(),
    cookies(),
  ]);
  const locations = access.unrestricted ? allLocations : allLocations.filter(location => access.locationIds.includes(location.id));
  const defaultDate = todayInZone(timezone);
  const requestedFacility = params.facility === "all" ? undefined : params.facility ?? cookieStore.get(FACILITY_COOKIE)?.value;

  return (
    <OwnerPage>
      <PageHeader
        title="Daily collections"
        purpose="Review payments and count cash at close."
      />
      <details className="mt-2 text-sm text-ink-2"><summary className="min-h-11 cursor-pointer">About daily close</summary><p>Payments are grouped by method and recipient. Confirm the physical cash count; any variance is shown, never adjusted away.</p></details>
      <CollectionsReport
        defaultDate={defaultDate}
        locations={locations}
        facilityLabel={resolveTerm(terminology, "facility", 1)}
        canConfirm={hasPermission(ctx, "payments.record")}
        canReopen={hasPermission(ctx, "settings.manage")}
        initialLocationId={requestedFacility}
        showNavigation
      />
    </OwnerPage>
  );
}
