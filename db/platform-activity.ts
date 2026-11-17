import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { platformAuditLog } from "./schema/platform-users";
import { tenants } from "./schema/tenants";
import { istDayBounds, parseCalendarDate, parseCalendarInstant } from "@/lib/time/calendar";
import { OPS_OUTCOMES } from "@/lib/ops-outcomes";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a calendar date (yyyy-mm-dd)")
  .refine(
    (value) => parseCalendarDate(value) !== null,
    "expected a real calendar date (yyyy-mm-dd)",
  );

const legacyInstant = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => parseCalendarInstant(value) !== null,
    "expected a real instant",
  );

const filterSchema = z.object({
  tenantId: z.string().uuid().optional(),
  action: z.string().min(1).max(120).optional(),
  // Ops completion 2026-11-09 — the investigation filters. `actorId`
  // and `correlationId` are EXACT uuids; `outcome` is one of the
  // canonical recorded outcomes.
  actorId: z.string().uuid().optional(),
  correlationId: z.string().uuid().optional(),
  outcome: z.enum(OPS_OUTCOMES).optional(),
  since: z.union([legacyInstant, calendarDate]).optional(),
  until: z.union([legacyInstant, calendarDate]).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).max(100000).default(0),
});

export type PlatformActivityFilter = Omit<z.input<typeof filterSchema>, "outcome"> & { outcome?: string };

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

/**
 * The predicate for a `since` bound.
 *
 * A calendar date is the START of its IST day; an explicit instant is
 * compared exactly, as it always was.
 */
function sinceCondition(value: string) {
  if (parseCalendarDate(value)) {
    return gte(platformAuditLog.createdAt, istDayBounds(value).fromUtc);
  }
  return gte(platformAuditLog.createdAt, new Date(value));
}

/**
 * The predicate for an `until` bound.
 *
 * A calendar date includes its WHOLE IST day: the upper bound is the
 * next midnight, and the comparison is exclusive — the last microsecond
 * of the chosen day is inside the window, the next midnight is outside
 * it. An explicit instant is compared exactly and inclusively, as it
 * always was.
 */
function untilCondition(value: string) {
  if (parseCalendarDate(value)) {
    return lt(platformAuditLog.createdAt, istDayBounds(value).toUtc);
  }
  return lte(platformAuditLog.createdAt, new Date(value));
}

export async function listPlatformActivity(
  rawFilter: PlatformActivityFilter,
): Promise<{ rows: PlatformActivityRow[]; total: number }> {
  const filter = filterSchema.parse(rawFilter);
  return withPlatformAdmin(async (tx) => {
    const conditions = [];
    if (filter.tenantId) conditions.push(eq(platformAuditLog.tenantId, filter.tenantId));
    if (filter.action) conditions.push(eq(platformAuditLog.action, filter.action));
    // Ops completion 2026-11-09 — the investigation predicates. The actor
    // is a column; the outcome and the correlation id live in the row's
    // own detail, so they are extracted from it. An EXACT match on the
    // recorded value, never a prefix.
    if (filter.actorId) conditions.push(eq(platformAuditLog.actorId, filter.actorId));
    if (filter.correlationId) {
      conditions.push(
        eq(sql`${platformAuditLog.detail}->>'correlationId'`, filter.correlationId),
      );
    }
    if (filter.outcome) {
      conditions.push(eq(sql`${platformAuditLog.detail}->>'outcome'`, filter.outcome));
    }
    if (filter.since) conditions.push(sinceCondition(filter.since));
    if (filter.until) conditions.push(untilCondition(filter.until));

    // The COUNT is computed from the SAME conditions as the rows, so the
    // total can never describe a different set from the list.
    const [{ n: total }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(platformAuditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

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

/**
 * Pull the most-recent action names so the filter UI can render an
 * "action" picker without a fresh inference. Capped at 50 distinct
 * values so the picker stays sensibly-sized; returns them sorted
 * alphabetically.
 */
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
