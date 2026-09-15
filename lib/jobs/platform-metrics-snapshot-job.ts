import { sql } from "drizzle-orm";
import { withPlatformAdmin, withPlatformMetricsWriter } from "@/db/scope";
import { tenants } from "@/db/schema/tenants";
import { platformMetricsDaily } from "@/db/schema/platform-metrics";
import {
  TENANT_HEALTH_JOINS,
  TENANT_HEALTH_COLUMNS,
  classifyTenantHealth,
} from "@/db/tenant-health";
import { todayInZone } from "@/lib/time/tz";

// PR3 (ops console improvements) — platform.metrics-snapshot, the one
// cross-tenant job in worker/index.ts (see the comment there for why
// this is a deliberate, singular exception). Upserts one row per day so the
// Overview KPI cards have a real number to diff against instead of a
// fabricated delta — a snapshot that doesn't exist yet for "N days
// ago" just means no delta is shown, not an error.
//
// "At risk" reuses db/tenant-health.ts's own classifier rather than
// re-deriving the rule in SQL — the KPI count and the tenants-list
// pill must never be able to drift apart from each other.
//
// Runs once/day for the whole platform, not per tenant-timezone (there
// is no single tenant to anchor to) — dated in IST, this product's
// home timezone (CLAUDE.md: timestamps displayed IST).
//
// Two-transaction shape: a withPlatformAdmin transaction reads the
// tenant tables; a withPlatformMetricsWriter transaction writes the
// platform_metrics_daily row. Atomicity is sacrificed for mutual
// exclusion between the two scopes — withPlatformMetricsWriter
// sets ONLY app.platform_metrics_writer, so it cannot reach any
// tenant table; withPlatformAdmin's RLS privilege on platform_
// metrics_daily is read-only after migration
// 20260917000000_platform_metrics_writer_scope.sql, so it cannot
// write the snapshot. The upsert is idempotent and the snapshot is
// one row per day, so a partial failure means a stale row until
// the next run, not missing counts.
export async function runPlatformMetricsSnapshotJob(): Promise<void> {
  const onDate = todayInZone("Asia/Kolkata");

  const counts = await withPlatformAdmin(async (tx) => {
    const statusCountsResult = await tx.execute(sql`
      select
        count(*) filter (where status = 'active')::int as "activeTenants",
        count(*) filter (where status = 'trial')::int as "trialTenants"
      from ${tenants}
    `);
    const statusCounts = (
      statusCountsResult as unknown as {
        rows: Array<{ activeTenants: number; trialTenants: number }>;
      }
    ).rows[0]!;

    const healthRowsResult = await tx.execute(sql`
      select
        ${tenants.id}             as id,
        ${tenants.status}         as status,
        ${tenants.createdAt}      as "createdAt",
        ${tenants.trialExpiresAt} as "trialExpiresAt",
        coalesce(members.cnt, 0)  as "memberCount",
        ${TENANT_HEALTH_COLUMNS}
      from ${tenants}
      left join (
        select tenant_id, count(*)::int as cnt from members group by tenant_id
      ) members on members.tenant_id = ${tenants.id}
      ${TENANT_HEALTH_JOINS}
      where ${tenants.status} <> 'churned'
    `);
    type HealthRow = {
      status: "trial" | "active" | "suspended" | "churned";
      createdAt: string;
      trialExpiresAt: string | null;
      memberCount: number;
      healthMaxOverdueDays: number | null;
      healthLastActiveOn: string | null;
      healthFailed7d: number | string;
      healthOldestPendingAt: string | null;
    };
    const healthRows = (healthRowsResult as unknown as { rows: HealthRow[] }).rows;
    const atRiskTenants = healthRows.filter(
      (r) =>
        classifyTenantHealth({
          tenantStatus: r.status,
          createdAt: new Date(r.createdAt),
          memberCount: Number(r.memberCount),
          trialExpiresAt: r.trialExpiresAt ? new Date(r.trialExpiresAt) : null,
          maxOverdueDays: r.healthMaxOverdueDays,
          lastActiveOn: r.healthLastActiveOn ? new Date(r.healthLastActiveOn) : null,
          failed7d: Number(r.healthFailed7d),
          oldestPendingAt: r.healthOldestPendingAt
            ? new Date(r.healthOldestPendingAt) : null,
        }).status === "at_risk",
    ).length;

    const openTasksResult = await tx.execute(sql`
      select count(*)::int as "openOpsTasks"
      from config_change_requests
      where status = 'requested'
    `);
    const { openOpsTasks } = (
      openTasksResult as unknown as { rows: Array<{ openOpsTasks: number }> }
    ).rows[0]!;

    return {
      activeTenants: statusCounts.activeTenants,
      trialTenants: statusCounts.trialTenants,
      atRiskTenants,
      openOpsTasks,
    };
  });

  await withPlatformMetricsWriter(async (tx) => {
    await tx
      .insert(platformMetricsDaily)
      .values({ onDate, ...counts, computedAt: new Date() })
      .onConflictDoUpdate({
        target: platformMetricsDaily.onDate,
        set: { ...counts, computedAt: new Date() },
      });
  });

  console.log(`[platform.metrics-snapshot] ${onDate} snapshot written.`);
}
