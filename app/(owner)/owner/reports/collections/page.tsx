import { requireOwner } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { listLocationsAction } from "@/lib/actions/people";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { todayInZone } from "@/lib/time/tz";
import { CollectionsReport } from "@/components/reports/collections-report";
import { BackLink } from "@/components/ui/BackLink";

// C-34 — daily collections: what came in, by method and by the person
// who took it, with the cash count confirmation. Accountant-grade
// (reports.financial gates the read at the action layer); confirming
// is a counter action (payments.record).

export default async function CollectionsPage() {
  const ctx = await requireOwner();
  const [locations, timezone, terminology] = await Promise.all([
    listLocationsAction(),
    getTenantTimezoneAction(),
    // Fetched here so the report's facility label follows the tenant's
    // vocabulary (L3 audit rule: no hardcoded vocab in JSX text).
    getTerminologyAction(),
  ]);
  const defaultDate = todayInZone(timezone);

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/reports" label="Reports" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Daily collections
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Payments recorded at the counter, grouped by method and by the person
        who took them. Count the physical cash at close and confirm it here —
        a variance is shown, never adjusted away.
      </p>
      <CollectionsReport
        defaultDate={defaultDate}
        locations={locations}
        facilityLabel={resolveTerm(terminology, "facility", 1)}
        canConfirm={hasPermission(ctx, "payments.record")}
      />
    </main>
  );
}
