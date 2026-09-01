import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatformAdmin } from "./scope";
import { withTenant } from "./tenant";
import { tenants } from "./schema/tenants";
import { plans } from "./schema/platform";
import { platformAuditLog } from "./schema/platform-users";
import { locations } from "./schema/locations";
import { resolveTenantFeatureKeys } from "./features";
import type { TenantId } from "@/lib/ids";

// Aggregated row for the operator tenant list. Member count and
// location count are denormalised in the same SELECT — single round
// trip, single statement, one withPlatformAdmin() scope.
export type TenantListRow = {
  id: TenantId;
  slug: string;
  name: string;
  status: "trial" | "active" | "suspended" | "churned";
  planId: string | null;
  planName: string | null;
  memberCount: number;
  locationCount: number;
  createdAt: Date;
  presetKey: string | null;
  presetVersion: number | null;
};

export type TenantListResult = {
  rows: TenantListRow[];
  total: number;
};

// All four status values that the schema check constraint allows.
// Kept in sync with db/schema/tenants.ts's check constraint.
const TENANT_STATUS = ["trial", "active", "suspended", "churned"] as const;
type TenantStatus = (typeof TENANT_STATUS)[number];

export const listTenantsInput = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(TENANT_STATUS).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
// Input type: all fields optional, defaults applied at parse time.
export type ListTenantsInput = z.input<typeof listTenantsInput>;

// SQL builds are all in one statement to keep the query plan readable
// and so a future EXPLAIN lands on one query, not four. The search
// uses ILIKE with %term% on slug OR name; with < 200 tenants per page
// in practice this is fine, and a small tenant table is the design
// (architecture.md §1: one tenant = one academy, not one tenant per
// customer of a SaaS).
//
// COUNT(*) on the same query for `total` — Drizzle doesn't have a
// clean "second result set" helper, so we run two queries inside one
// withPlatformAdmin() scope. Both go through the same `app_user`
// connection with `app.platform_admin = 'true'` set, and the new
// platform_admin_select RLS policy (migration
// 20260901162028_platform_admin_tenant_read) grants the visibility.
function buildFilters(input: ListTenantsInput) {
  const conds = [];
  if (input.search) {
    const like = `%${input.search}%`;
    conds.push(sql`(${tenants.slug} ilike ${like} or ${tenants.name} ilike ${like})`);
  }
  if (input.status) {
    conds.push(sql`${tenants.status} = ${input.status}`);
  }
  return conds.length === 0
    ? sql`true`
    : sql.join(conds, sql` and `);
}

export async function listTenants(
  rawInput: ListTenantsInput,
): Promise<TenantListResult> {
  // Parse at the boundary — defaults applied here, not at the type
  // signature. Standing rule: every service function opens with zod
  // parse, and the Server Action preamble test would catch a regression
  // if this were ever a Server Action.
  const input = listTenantsInput.parse(rawInput);
  return withPlatformAdmin(async (tx) => {
    const where = buildFilters(input);

    const data = await tx.execute(sql`
      select
        ${tenants.id}              as id,
        ${tenants.slug}            as slug,
        ${tenants.name}            as name,
        ${tenants.status}          as status,
        ${tenants.planId}          as "planId",
        ${plans.name}              as "planName",
        ${tenants.createdAt}       as "createdAt",
        ${tenants.presetKey}       as "presetKey",
        ${tenants.presetVersion}   as "presetVersion",
        coalesce(members.cnt, 0)   as "memberCount",
        coalesce(locations.cnt, 0) as "locationCount"
      from ${tenants}
      left join ${plans} on ${plans.id} = ${tenants.planId}
      left join (
        select tenant_id, count(*)::int as cnt
        from members
        group by tenant_id
      ) members on members.tenant_id = ${tenants.id}
      left join (
        select tenant_id, count(*)::int as cnt
        from locations
        where deleted_at is null
        group by tenant_id
      ) locations on locations.tenant_id = ${tenants.id}
      where ${where}
      order by ${tenants.createdAt} desc
      limit ${input.limit}
      offset ${input.offset}
    `);

    const countResult = await tx.execute(sql`
      select count(*)::int as total
      from ${tenants}
      where ${where}
    `);

    type RowShape = {
      id: string;
      slug: string;
      name: string;
      status: TenantStatus;
      planId: string | null;
      planName: string | null;
      memberCount: number;
      locationCount: number;
      createdAt: string;
      presetKey: string | null;
      presetVersion: number | null;
    };

    const rows = (data as unknown as { rows: RowShape[] }).rows.map((r) => ({
      id: r.id as TenantId,
      slug: r.slug,
      name: r.name,
      status: r.status,
      planId: r.planId,
      planName: r.planName,
      memberCount: Number(r.memberCount),
      locationCount: Number(r.locationCount),
      createdAt: new Date(r.createdAt),
      presetKey: r.presetKey,
      presetVersion: r.presetVersion,
    }));

    const totalRows = (countResult as unknown as { rows: Array<{ total: number }> })
      .rows;
    const totalRow = totalRows[0];
    return {
      rows,
      total: totalRow ? Number(totalRow.total) : 0,
    };
  });
}

// Phase 1.4 — read-only tenant detail. Settings, locations, feature
// state, usage, activity. Cross-tenant visibility comes from
// withPlatformAdmin() (the same scope listTenants uses); per-tenant
// reads (locations, features, sessions-this-month) go through
// withTenant() so the page reuses the same access path the tenant's
// own users do.
export type TenantDetail = {
  id: TenantId;
  slug: string;
  name: string;
  status: "trial" | "active" | "suspended" | "churned";
  planId: string | null;
  planName: string | null;
  timezone: string;
  currency: string;
  gstin: string | null;
  presetKey: string | null;
  presetVersion: number | null;
  offlineSyncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
  locationCount: number;
  sessionsThisMonth: number;
  featureKeys: string[];
  locations: Array<{
    id: string;
    name: string;
    isPrimary: boolean;
    createdAt: Date;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    actorId: string | null;
    detail: Record<string, unknown>;
    createdAt: Date;
  }>;
};

export type TenantDetailResult = TenantDetail | null;

export async function getTenantDetail(
  tenantId: TenantId,
): Promise<TenantDetailResult> {
  // The header row: tenant + plan + denormalised counts, including
  // sessions-this-month for the activity signal. Single SELECT under
  // withPlatformAdmin() so it shares the same visibility scope as the
  // list — the existence check happens in the WHERE.
  const header = await withPlatformAdmin(async (tx) => {
    const data = await tx.execute(sql`
      select
        ${tenants.id}                  as id,
        ${tenants.slug}                as slug,
        ${tenants.name}                as name,
        ${tenants.status}              as status,
        ${tenants.planId}              as "planId",
        ${plans.name}                  as "planName",
        ${tenants.timezone}            as timezone,
        ${tenants.currency}            as currency,
        ${tenants.gstin}               as gstin,
        ${tenants.presetKey}           as "presetKey",
        ${tenants.presetVersion}       as "presetVersion",
        ${tenants.offlineSyncEnabled}  as "offlineSyncEnabled",
        ${tenants.createdAt}           as "createdAt",
        ${tenants.updatedAt}           as "updatedAt",
        coalesce(members.cnt, 0)       as "memberCount",
        coalesce(locations.cnt, 0)     as "locationCount",
        coalesce(sessions.cnt, 0)      as "sessionsThisMonth"
      from ${tenants}
      left join ${plans} on ${plans.id} = ${tenants.planId}
      left join (
        select tenant_id, count(*)::int as cnt
        from members
        group by tenant_id
      ) members on members.tenant_id = ${tenants.id}
      left join (
        select tenant_id, count(*)::int as cnt
        from locations
        where deleted_at is null
        group by tenant_id
      ) locations on locations.tenant_id = ${tenants.id}
      left join (
        select tenant_id, count(*)::int as cnt
        from sessions
        where starts_at >= date_trunc('month', now())
        group by tenant_id
      ) sessions on sessions.tenant_id = ${tenants.id}
      where ${tenants.id} = ${tenantId}
    `);
    return (data as unknown as { rows: Array<{
      id: string;
      slug: string;
      name: string;
      status: "trial" | "active" | "suspended" | "churned";
      planId: string | null;
      planName: string | null;
      timezone: string;
      currency: string;
      gstin: string | null;
      presetKey: string | null;
      presetVersion: number | null;
      offlineSyncEnabled: boolean;
      createdAt: string;
      updatedAt: string;
      memberCount: number;
      locationCount: number;
      sessionsThisMonth: number;
    } | undefined> }).rows[0];
  });

  if (!header) return null;

  // Tenant-scoped reads via withTenant — same path the tenant's own
  // owner would take. Reads locations, resolved feature keys, and the
  // last 20 platform_audit_log entries scoped to this tenant.
  const [locationsList, featureKeys, activity] = await Promise.all([
    withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: locations.id,
          name: locations.name,
          isPrimary: locations.isPrimary,
          createdAt: locations.createdAt,
        })
        .from(locations)
        .where(sql`${locations.deletedAt} is null`)
        .orderBy(sql`${locations.isPrimary} desc, ${locations.name} asc`);
      return rows;
    }),
    resolveTenantFeatureKeys(tenantId),
    withPlatformAdmin(async (tx) => {
      const rows = await tx
        .select({
          id: platformAuditLog.id,
          action: platformAuditLog.action,
          actorId: platformAuditLog.actorId,
          detail: platformAuditLog.detail,
          createdAt: platformAuditLog.createdAt,
        })
        .from(platformAuditLog)
        .where(eq(platformAuditLog.tenantId, tenantId))
        .orderBy(sql`${platformAuditLog.createdAt} desc`)
        .limit(20);
      return rows;
    }),
  ]);

  return {
    id: header.id as TenantId,
    slug: header.slug,
    name: header.name,
    status: header.status,
    planId: header.planId,
    planName: header.planName,
    timezone: header.timezone,
    currency: header.currency,
    gstin: header.gstin,
    presetKey: header.presetKey,
    presetVersion: header.presetVersion,
    offlineSyncEnabled: header.offlineSyncEnabled,
    createdAt: new Date(header.createdAt),
    updatedAt: new Date(header.updatedAt),
    memberCount: Number(header.memberCount),
    locationCount: Number(header.locationCount),
    sessionsThisMonth: Number(header.sessionsThisMonth),
    featureKeys,
    locations: locationsList.map((l) => ({
      id: l.id,
      name: l.name,
      isPrimary: l.isPrimary,
      createdAt: l.createdAt,
    })),
    recentActivity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      actorId: a.actorId,
      detail: (a.detail ?? {}) as Record<string, unknown>,
      createdAt: a.createdAt,
    })),
  };
}
