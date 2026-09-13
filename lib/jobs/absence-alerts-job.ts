import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { detectAbsenceAlerts } from "@/lib/services/absence-alerts";
import type { TenantId } from "@/lib/ids";

// R.8 — daily absence-alert job. Mirrors runSessionsGenerateJob: the
// tenantId comes from the schedule's own data (db/deploy.ts never
// enumerates tenants into the worker), and a stale schedule for a
// suspended/churned tenant is defused by the status check.
//
// The detection service is idempotent via the alerts unique key, so a
// duplicate delivery inserts nothing.
export async function runAbsenceAlertsJob(tenantId: TenantId): Promise<void> {
  // Status check in its own short scope; detectAbsenceAlerts opens its
  // own withTenant and withTenant cannot nest (db/scope.ts).
  const active = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return Boolean(row && (row.status === "trial" || row.status === "active"));
  });
  if (!active) return;

  const result = await detectAbsenceAlerts({ tenantId });
  console.log(
    `[alerts.absence] tenant ${tenantId}: ${result.inserted} alert(s) inserted (${result.candidates} candidate(s))`,
  );
}
