import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { enquiries, type EnquiryStage, type EnquirySource } from "@/db/schema/enquiries";
import type { ActionCtx } from "@/lib/auth/context";
import {
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  callerHasPermission,
  callerIsLegacySystem,
} from "@/lib/services/resource-access";
import type { MemberId } from "@/lib/ids";

// The enquiry visibility rule and the shared row vocabulary.
//
// R04 (2026-10-13 role-workflow audit) — enquiry visibility.
//
// An enquiry belongs to a site (location_id). Non-management callers
// (reception) see and act on located enquiries within their allowed
// locations only; an unresolved enquiry (location_id IS NULL, e.g. a
// historical row the backfill could not place) is visible and
// actionable only through the management review path
// (settings.manage holders) — missing location never means
// unrestricted access. Management still respects location-scoped
// memberships for located rows and keeps the unresolved queue.
//
// Every enquiry read in this service family resolves its visibility
// through THESE two functions, so the rule cannot drift between the
// list, the detail, the follow-ups, the pipeline and the aggregate.

export type EnquiryScope = { management: boolean; predicate: SQL | undefined };

export async function enquiryScope(tx: TenantTx, ctx: ActionCtx): Promise<EnquiryScope> {
  const management =
    callerIsLegacySystem(ctx) ||
    (await callerHasPermission(tx, ctx, "settings.manage"));
  const access = await resolveLocationAccess(tx, ctx);

  if (access.unrestricted) {
    // Management keeps every located row plus the unresolved queue;
    // a non-management unrestricted caller still never sees
    // unresolved records.
    return { management, predicate: management ? undefined : isNotNull(enquiries.locationId) };
  }

  const located =
    access.locationIds.length > 0
      ? inArray(enquiries.locationId, access.locationIds)
      : sql`false`;
  return {
    management,
    predicate: management
      ? or(located, isNull(enquiries.locationId))
      : and(isNotNull(enquiries.locationId), located),
  };
}

export function enquiryConditions(ctx: ActionCtx, predicate: SQL | undefined, extra: SQL[] = []): SQL[] {
  const conditions: SQL[] = [
    eq(enquiries.tenantId, ctx.tenantId),
    isNull(enquiries.deletedAt),
    ...extra,
  ];
  if (predicate) conditions.push(predicate);
  return conditions;
}

export type VisibleEnquiry = {
  id: string;
  stage: string;
  memberId: MemberId | null;
  trialBatchId: string | null;
  fullName: string;
  phone: string | null;
  locationId: string | null;
};

export async function visibleEnquiry(
  tx: TenantTx,
  ctx: ActionCtx,
  enquiryId: string,
): Promise<VisibleEnquiry | null> {
  return readEnquiry(tx, ctx, enquiryId, false);
}

// The same read, but it LOCKS the row (FOR UPDATE) for the rest of
// the transaction.
//
// Use it when the decision to mutate depends on the row's CURRENT
// state — the stage graph decides from the stage the row holds now.
// With the lock, "read the state, decide, write" is one atomic step:
// two concurrent callers cannot both decide against the same stale
// state, so the second one cannot apply a transition the graph
// forbids (a converted enquiry reopened to "lost") or overwrite the
// first one's stage while its audit row claims a before-state that
// never was.
//
// The lock is taken INSIDE the same tenant + location scope as the
// read: a caller that cannot SEE the row never locks it. The lock can
// therefore not be used to stall, or to probe for, another tenant's
// or another location's enquiry — an out-of-scope caller gets
// "Enquiry not found." without waiting for anybody.
export async function lockVisibleEnquiry(
  tx: TenantTx,
  ctx: ActionCtx,
  enquiryId: string,
): Promise<VisibleEnquiry | null> {
  return readEnquiry(tx, ctx, enquiryId, true);
}

// The one query behind both reads, so the visibility rule cannot
// drift between them.
async function readEnquiry(
  tx: TenantTx,
  ctx: ActionCtx,
  enquiryId: string,
  lock: boolean,
): Promise<VisibleEnquiry | null> {
  const { predicate } = await enquiryScope(tx, ctx);
  const query = tx
    .select({
      id: enquiries.id,
      stage: enquiries.stage,
      memberId: enquiries.memberId,
      trialBatchId: enquiries.trialBatchId,
      fullName: enquiries.fullName,
      phone: enquiries.phone,
      locationId: enquiries.locationId,
    })
    .from(enquiries)
    .where(and(...enquiryConditions(ctx, predicate, [eq(enquiries.id, enquiryId)])))
    .limit(1);
  // Drizzle emits `... limit 1 for update`, which is valid PostgreSQL.
  const rows = lock ? await query.for("update") : await query;
  return rows[0] ?? null;
}

// The row shape every enquiry read returns. The mapper lives here so
// the capture path and the read paths cannot drift apart on what a
// caller sees.
export type EnquiryRow = {
  id: string;
  fullName: string;
  phone: string | null;
  source: EnquirySource;
  stage: EnquiryStage;
  memberId: MemberId | null;
  locationId: string | null;
  createdAt: Date;
};

type EnquiryRowSource = {
  id: string;
  fullName: string;
  phone: string | null;
  source: string;
  stage: string;
  memberId: MemberId | null;
  locationId: string | null;
  createdAt: Date;
};

export function toEnquiryRow(row: EnquiryRowSource): EnquiryRow {
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    source: row.source as EnquirySource,
    stage: row.stage as EnquiryStage,
    memberId: row.memberId,
    locationId: row.locationId,
    createdAt: row.createdAt,
  };
}
