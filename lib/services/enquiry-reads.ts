import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, enquiryFollowUps, type EnquiryStage } from "@/db/schema/enquiries";
import type { ActionCtx } from "@/lib/auth/context";
import {
  enquiryConditions,
  enquiryScope,
  toEnquiryRow,
  type EnquiryRow,
} from "@/lib/services/enquiry-scope";

// The enquiry READ side: the list, the detail, the overdue follow-ups
// and the current-stage aggregate.
//
// Every one of them resolves visibility through the shared rule in
// ./enquiry-scope, so the chart, the list and the detail can never
// disagree about who may see an enquiry.

export async function listEnquiries(
  ctx: ActionCtx,
  filters: { stage?: EnquiryStage } = {},
): Promise<EnquiryRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    const extra: SQL[] = [];
    if (filters.stage) extra.push(eq(enquiries.stage, filters.stage));

    const rows = await tx
      .select()
      .from(enquiries)
      .where(and(...enquiryConditions(ctx, predicate, extra)))
      .orderBy(desc(enquiries.createdAt));

    return rows.map(toEnquiryRow);
  });
}

export type EnquiryDetail = EnquiryRow & {
  notes: string | null;
  trialBatchId: string | null;
  followUps: Array<{ id: string; dueAt: Date; note: string | null; doneAt: Date | null }>;
};

export async function getEnquiryDetail(
  ctx: ActionCtx,
  enquiryId: string,
): Promise<EnquiryDetail | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    const [row] = await tx
      .select()
      .from(enquiries)
      .where(and(...enquiryConditions(ctx, predicate, [eq(enquiries.id, enquiryId)])));
    if (!row) return null;

    const followUps = await tx
      .select({
        id: enquiryFollowUps.id,
        dueAt: enquiryFollowUps.dueAt,
        note: enquiryFollowUps.note,
        doneAt: enquiryFollowUps.doneAt,
      })
      .from(enquiryFollowUps)
      .where(and(eq(enquiryFollowUps.enquiryId, enquiryId), eq(enquiryFollowUps.tenantId, ctx.tenantId)))
      .orderBy(asc(enquiryFollowUps.dueAt));

    return {
      ...toEnquiryRow(row),
      notes: row.notes,
      trialBatchId: row.trialBatchId,
      followUps,
    };
  });
}

export type OverdueFollowUp = {
  id: string;
  enquiryId: string;
  enquiryName: string;
  dueAt: Date;
  note: string | null;
};

// C-13 done-when: "overdue follow-ups surface on the owner dashboard."
export async function listOverdueFollowUps(ctx: ActionCtx): Promise<OverdueFollowUp[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    return tx
      .select({
        id: enquiryFollowUps.id,
        enquiryId: enquiryFollowUps.enquiryId,
        enquiryName: enquiries.fullName,
        dueAt: enquiryFollowUps.dueAt,
        note: enquiryFollowUps.note,
      })
      .from(enquiryFollowUps)
      .innerJoin(enquiries, eq(enquiries.id, enquiryFollowUps.enquiryId))
      .where(
        and(...enquiryConditions(ctx, predicate, [
          eq(enquiryFollowUps.tenantId, ctx.tenantId),
          isNull(enquiryFollowUps.doneAt),
          lt(enquiryFollowUps.dueAt, sql`now()`),
        ])),
      )
      .orderBy(asc(enquiryFollowUps.dueAt));
  });
}

// The aggregate read behind the owner-insights enquiry chart
// (chart-gallery05): the CURRENT stage of the enquiries CREATED inside
// a window, counted once each.
//
// It exists so a dashboard chart never pulls the whole live enquiry
// list — with names and phones — into the service process. The
// visibility rule is NOT re-implemented: it is the same
// `enquiryScope` predicate and the same `enquiryConditions` filter the
// list uses, so the chart can never disagree with the Enquiries page.
//
// The window is a half-open instant range already resolved in the
// TENANT's timezone by the caller; the cohort is "created inside the
// window".
export type EnquiryStageCount = { stage: EnquiryStage; count: number };

export type EnquiryStageCounts = {
  /** Enquiries in the cohort — each counted exactly once. */
  total: number;
  byStage: EnquiryStageCount[];
};

export async function countEnquiriesByCurrentStage(
  ctx: ActionCtx,
  window: { fromUtc: Date; toUtc: Date },
  options: { locationId?: string } = {},
): Promise<EnquiryStageCounts> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    const extra: SQL[] = [
      gte(enquiries.createdAt, window.fromUtc),
      lt(enquiries.createdAt, window.toUtc),
    ];
    // A requested location can only NARROW the cohort — the same
    // predicate the list read applies, one more AND.
    if (options.locationId) extra.push(eq(enquiries.locationId, options.locationId));

    const rows = await tx
      .select({ stage: enquiries.stage, count: sql<number>`count(*)::int` })
      .from(enquiries)
      .where(and(...enquiryConditions(ctx, predicate, extra)))
      .groupBy(enquiries.stage);

    const byStage = rows.map((row) => ({
      stage: row.stage as EnquiryStage,
      count: Number(row.count),
    }));
    return {
      total: byStage.reduce((sum, row) => sum + row.count, 0),
      byStage,
    };
  });
}
