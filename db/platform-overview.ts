import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { platformMetricsDaily } from "./schema/platform-metrics";
import {
  TENANT_HEALTH_JOINS,
  TENANT_HEALTH_COLUMNS,
  classifyTenantHealth,
  type TenantHealthDetail,
} from "./tenant-health";
import type { TenantId } from "@/lib/ids";

// PR3 (ops console improvements) — read side for the Overview
// dashboard's two data-driven sections: the KPI strip and the
// needs-attention queue. Both are read-only aggregates under
// withPlatformAdmin(); neither writes anything.

const DELTA_LOOKBACK_DAYS = 30;

export type MetricDelta = {
  current: number;
  // null = no snapshot exists far enough back yet — shown as "no
  // comparison yet", never a fabricated 0% or "—" that looks like a
  // real answer.
  previous: number | null;
};

export type PlatformMetricsSummary = {
  activeTenants: MetricDelta;
  trialTenants: MetricDelta;
  atRiskTenants: MetricDelta;
  openOpsTasks: MetricDelta;
  // null = the snapshot job has never run yet (fresh deploy).
  asOf: Date | null;
};

function delta(current: number | undefined, previous: number | undefined): MetricDelta {
  return { current: current ?? 0, previous: previous ?? null };
}

export async function getPlatformMetricsSummary(): Promise<PlatformMetricsSummary> {
  return withPlatformAdmin(async (tx) => {
    const latestResult = await tx.execute(sql`
      select on_date, active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks, computed_at
      from ${platformMetricsDaily}
      order by on_date desc
      limit 1
    `);
    type Row = {
      on_date: string;
      active_tenants: number;
      trial_tenants: number;
      at_risk_tenants: number;
      open_ops_tasks: number;
      computed_at: string;
    };
    const latest = (latestResult as unknown as { rows: Row[] }).rows[0];
    if (!latest) {
      return {
        activeTenants: delta(undefined, undefined),
        trialTenants: delta(undefined, undefined),
        atRiskTenants: delta(undefined, undefined),
        openOpsTasks: delta(undefined, undefined),
        asOf: null,
      };
    }

    const previousResult = await tx.execute(sql`
      select active_tenants, trial_tenants, at_risk_tenants, open_ops_tasks
      from ${platformMetricsDaily}
      where on_date <= (${latest.on_date}::date - ${DELTA_LOOKBACK_DAYS}::int)
      order by on_date desc
      limit 1
    `);
    const previous = (previousResult as unknown as { rows: Row[] }).rows[0];

    return {
      activeTenants: delta(latest.active_tenants, previous?.active_tenants),
      trialTenants: delta(latest.trial_tenants, previous?.trial_tenants),
      atRiskTenants: delta(latest.at_risk_tenants, previous?.at_risk_tenants),
      openOpsTasks: delta(latest.open_ops_tasks, previous?.open_ops_tasks),
      asOf: new Date(latest.computed_at),
    };
  });
}

export type AttentionQueueItem = TenantHealthDetail & {
  tenantId: TenantId;
  tenantName: string;
  tenantSlug: string;
};

// Every non-healthy, non-churned tenant's issues, flattened to one row
// per issue (a tenant with two problems gets two rows) — same shape
// the tenants-list Health column and the KPI "at risk" count are
// built from, so the three can never disagree with each other.
export async function getNeedsAttentionQueue(
  limit = 20,
): Promise<AttentionQueueItem[]> {
  return withPlatformAdmin(async (tx) => {
    const result = await tx.execute(sql`
      select
        ${tenants.id}             as id,
        ${tenants.name}           as name,
        ${tenants.slug}           as slug,
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
    type Row = {
      id: string;
      name: string;
      slug: string;
      status: "trial" | "active" | "suspended" | "churned";
      createdAt: string;
      trialExpiresAt: string | null;
      memberCount: number;
      healthMaxOverdueDays: number | null;
      healthLastActiveOn: string | null;
      healthFailed7d: number | string;
      healthOldestPendingAt: string | null;
    };
    const rows = (result as unknown as { rows: Row[] }).rows;

    const items: AttentionQueueItem[] = [];
    for (const r of rows) {
      const { details } = classifyTenantHealth({
        tenantStatus: r.status,
        createdAt: new Date(r.createdAt),
        memberCount: Number(r.memberCount),
        trialExpiresAt: r.trialExpiresAt ? new Date(r.trialExpiresAt) : null,
        maxOverdueDays: r.healthMaxOverdueDays,
        lastActiveOn: r.healthLastActiveOn ? new Date(r.healthLastActiveOn) : null,
        failed7d: Number(r.healthFailed7d),
        oldestPendingAt: r.healthOldestPendingAt
          ? new Date(r.healthOldestPendingAt)
          : null,
      });
      for (const d of details) {
        items.push({
          ...d,
          tenantId: r.id as TenantId,
          tenantName: r.name,
          tenantSlug: r.slug,
        });
      }
    }

    // at_risk first, then oldest/most-urgent first within a tier
    // (nulls — count-based issues with no natural age — sort last).
    items.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "at_risk" ? -1 : 1;
      if (a.ageDays == null) return 1;
      if (b.ageDays == null) return -1;
      return b.ageDays - a.ageDays;
    });

    return items.slice(0, limit);
  });
}
