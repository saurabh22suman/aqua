import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./client";
import { withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { plans } from "./schema/platform";
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
