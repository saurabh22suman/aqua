import { and, eq, lt } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { subscriptions } from "@/db/schema/subscriptions";
import { todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// C-47 — subscriptions.expire. A subscription whose inclusive end
// date has passed becomes 'expired'. Idempotent: re-running the same
// night finds nothing left to expire. Paused subscriptions are left
// alone (a pause extends the end date; expiry applies to the live
// series only), and cancelled stays cancelled.
//
// System mutation: no tenant audit row (audit_log.actor_id is NOT
// NULL and a job has no user actor — the standing F-15 gap; the
// status/updated_at columns and this log line are the trace).
export async function runSubscriptionsExpireJob(
  tenantId: TenantId,
): Promise<void> {
  const expired = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row || (row.status !== "trial" && row.status !== "active")) return 0;

    const today = todayInZone(row.timezone);
    const rows = await tx
      .update(subscriptions)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(subscriptions.tenantId, tenantId),
          eq(subscriptions.status, "active"),
          lt(subscriptions.endsOn, today),
        ),
      )
      .returning({ id: subscriptions.id });
    return rows.length;
  });

  console.log(
    `[subscriptions.expire] tenant ${tenantId}: ${expired} subscription(s) expired`,
  );
}
