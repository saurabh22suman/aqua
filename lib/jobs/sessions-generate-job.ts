import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { generateSessions } from "@/lib/jobs/session-generator";
import type { TenantId } from "@/lib/ids";

// architecture.md §9 describes thirteen jobs; this is the one D3 called
// out as pilot-critical — without it, session generation stops and
// nobody notices until a coach opens an empty register. The other
// twelve are future work, not this task's scope.
//
// tenantId always comes from the job's own data (see worker/index.ts) —
// this function never enumerates tenants itself. A schedule can
// legitimately be stale (the tenant was suspended or churned after the
// schedule was created; db/deploy.ts's sync removes stale schedules on
// the next deploy, but nothing guarantees that's already happened by
// the time this fires) — the status check below defuses that case using
// a read that's already permitted from inside withTenant() (the
// tenant_isolation policy lets a tenant read its own row), not a new
// exemption.
export async function runSessionsGenerateJob(tenantId: TenantId): Promise<void> {
  const created = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    if (!row || (row.status !== "trial" && row.status !== "active")) {
      return 0;
    }

    return generateSessions(tx, tenantId, row.timezone);
  });

  console.log(`[sessions.generate] tenant ${tenantId}: ${created} session(s) created`);
}
