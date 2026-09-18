import { and, eq, lt } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { subscriptions } from "@/db/schema/subscriptions";
import { writeAudit } from "@/lib/audit/write";
import { todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// C-47 — subscriptions.expire. A subscription whose inclusive end
// date has passed becomes 'expired'. Idempotent: re-running the same
// night finds nothing left to expire. Paused subscriptions are left
// alone (a pause extends the end date; expiry applies to the live
// series only), and cancelled stays cancelled.
//
// System mutation: one audit row per expired subscription, written in
// the same transaction as the status change, actor_type='system',
// actor_id NULL (E-01; this was the standing F-15 job gap).
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

    for (const expiredRow of rows) {
      await writeAudit(tx, {
        tenantId,
        actorType: "system",
        actorId: null,
        source: "job",
        action: "subscription.expire",
        entityType: "subscription",
        entityId: expiredRow.id,
        after: { status: "expired" },
        changedFields: ["status"],
      });
    }
    return rows.length;
  });

  console.log(
    `[subscriptions.expire] tenant ${tenantId}: ${expired} subscription(s) expired`,
  );
}
