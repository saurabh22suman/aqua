import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { platformAuditLog } from "./schema/platform-users";
import { tenants } from "./schema/tenants";

// Phase 3.9 — platform activity log. Platform-side service that
// reads platform_audit_log across tenants, with optional
// filters. platform_audit_log is RLS-exempt (db/allowlist.ts) —
// it carries the cross-tenant audit trail every platform-side
// mutation already writes to (tenant status transitions,
// invite-owner, feature catalogue edits, preset apply, etc).
//
// Standalone read so a per-tenant filter is optional rather
// than required (the per-tenant view exists already on the
// tenant detail page via getTenantDetail().recentActivity,
// documented at platform-tenants.ts:349). The cross-tenant
// view in this module is the "what did the platform
// operators do today" surface.
//
// All access goes through withPlatformAdmin(). The public
// envelope wraps the result with tenant name/slug so the UI
// doesn't need a second round trip per row.

const filterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform((s) => new Date(s).toISOString()))
    .optional(),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform((s) => new Date(s).toISOString()))
    .optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(100000).default(0),
});

export type PlatformActivityFilter = z.input<typeof filterSchema>;

export type PlatformActivityRow = {
  id: string;
  action: string;
  actorId: string | null;
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  detail: Record<string, unknown>;
  createdAt: Date;
};

// Read shape only — the audit table is append-only by grant
// (db/migrations/20260901110035_platform_users.sql: insert
// grant on app_user, no update/delete). Nothing in this module
// mutates the row.
export async function listPlatformActivity(
  rawFilter: PlatformActivityFilter,
): Promise<{ rows: PlatformActivityRow[]; total: number }> {
  const filter = filterSchema.parse(rawFilter);

  return withPlatformAdmin(async (tx) => {
    const conditions = [];
    if (filter.tenantId) conditions.push(eq(platformAuditLog.tenantId, filter.tenantId));
    if (filter.action) conditions.push(eq(platformAuditLog.action, filter.action));
    if (filter.since) conditions.push(gte(platformAuditLog.createdAt, new Date(filter.since)));
    if (filter.until) conditions.push(lte(platformAuditLog.createdAt, new Date(filter.until)));

    // Total count for the "X events" header (cheap because
    // platform_audit_log is append-only and indexed on created_at
    // desc).
    const [{ n: total }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(platformAuditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    // The join to tenants is LEFT because platform actions
    // exist that don't target a tenant (e.g. platform_user
    // creation, login events). Missing tenant surfaces as
    // nulls below.
    const rows = await tx
      .select({
        id: platformAuditLog.id,
        action: platformAuditLog.action,
        actorId: platformAuditLog.actorId,
        tenantId: platformAuditLog.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        detail: platformAuditLog.detail,
        createdAt: platformAuditLog.createdAt,
      })
      .from(platformAuditLog)
      .leftJoin(tenants, eq(tenants.id, platformAuditLog.tenantId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(platformAuditLog.createdAt))
      .limit(filter.limit)
      .offset(filter.offset);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorId: r.actorId,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantSlug: r.tenantSlug,
        detail: (r.detail ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt,
      })),
      total: Number(total),
    };
  });
}

// Caller-side helper that pulls the most-recent action names so
// the filter UI can render an "action" picker without a fresh
// inference. Capped at 50 distinct values so the picker stays
// sensibly-sized; returns them sorted alphabetically.
export async function listKnownActions(): Promise<string[]> {
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select({ action: platformAuditLog.action })
      .from(platformAuditLog)
      .groupBy(platformAuditLog.action)
      .orderBy(platformAuditLog.action);
    return rows.map((r) => r.action);
  });
}
