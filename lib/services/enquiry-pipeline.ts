import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, enquiryFollowUps, type EnquiryStage } from "@/db/schema/enquiries";
import type { ActionCtx } from "@/lib/auth/context";
import { ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import {
  enquiryConditions,
  enquiryScope,
  lockVisibleEnquiry,
  visibleEnquiry,
} from "@/lib/services/enquiry-scope";
import {
  auditEnquiryStageChanged,
  auditFollowUpCompleted,
  auditFollowUpCreated,
} from "@/lib/services/enquiry-audit";

// C-13 — the enquiry pipeline: stage transitions and follow-ups.

export type StageResult = { ok: true } | { ok: false; error: string };

// C-13: stage transitions follow the same allowed-graph shape C-08
// uses for member status (lib/enquiry-stage-graph.ts).
//
// The transition is audited to the ONE global audit trail
// (lib/audit/write.ts), in the same transaction as the update — there
// is no separate enquiry history table, and updated_at/updated_by name
// only the LAST editor, not the accountable history.
export async function transitionEnquiryStage(
  ctx: ActionCtx,
  input: { enquiryId: string; toStage: EnquiryStage },
): Promise<StageResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    // The row is LOCKED before its stage is read, so "read the stage,
    // check the graph, write the stage, write the audit" is one
    // atomic step. Without the lock two concurrent transitions decide
    // against the SAME stale stage: the second one can then apply a
    // transition the graph forbids (a converted enquiry reopened to
    // "lost") or overwrite the first one's stage, while its audit row
    // claims a before-state that never was. The lock is taken inside
    // the caller's own tenant + location scope, so a caller that may
    // not see the row never waits on it.
    const visible = await lockVisibleEnquiry(tx, ctx, input.enquiryId);
    if (!visible) return { ok: false, error: "Enquiry not found." };

    const fromStage = visible.stage as EnquiryStage;
    const allowed = ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? [];
    if (!allowed.includes(input.toStage)) {
      return { ok: false, error: `Cannot move an enquiry from ${fromStage} to ${input.toStage}.` };
    }

    await tx
      .update(enquiries)
      .set({ stage: input.toStage, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(enquiries.id, input.enquiryId));
    await auditEnquiryStageChanged(tx, ctx, {
      id: input.enquiryId,
      fromStage,
      toStage: input.toStage,
    });
    return { ok: true };
  });
}

export async function addFollowUp(
  ctx: ActionCtx,
  input: { enquiryId: string; dueAt: Date; note?: string },
): Promise<{ id: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleEnquiry(tx, ctx, input.enquiryId);
    if (!visible) throw new Error("Enquiry not found.");
    const [row] = await tx
      .insert(enquiryFollowUps)
      .values({
        tenantId: ctx.tenantId,
        enquiryId: input.enquiryId,
        dueAt: input.dueAt,
        note: input.note,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: enquiryFollowUps.id });
    await auditFollowUpCreated(tx, ctx, {
      id: row.id,
      enquiryId: input.enquiryId,
      dueAt: input.dueAt,
    });
    return row;
  });
}

export async function completeFollowUp(
  ctx: ActionCtx,
  followUpId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    const [row] = await tx
      .select({
        id: enquiryFollowUps.id,
        enquiryId: enquiryFollowUps.enquiryId,
        doneAt: enquiryFollowUps.doneAt,
      })
      .from(enquiryFollowUps)
      .innerJoin(enquiries, eq(enquiries.id, enquiryFollowUps.enquiryId))
      .where(
        and(...enquiryConditions(ctx, predicate, [
          eq(enquiryFollowUps.id, followUpId),
          eq(enquiryFollowUps.tenantId, ctx.tenantId),
        ])),
      )
      .for("update", { of: enquiryFollowUps });
    if (!row) return { ok: false, error: "Follow-up not found." };

    // Completing an already-completed follow-up changes nothing, so
    // it is a no-op: the completion time is not re-stamped and no
    // second, misleading audit row is written. The caller still sees
    // the follow-up as done.
    if (row.doneAt) return { ok: true };

    const doneAt = new Date();
    await tx
      .update(enquiryFollowUps)
      .set({ doneAt, updatedBy: ctx.userId })
      .where(eq(enquiryFollowUps.id, followUpId));
    await auditFollowUpCompleted(tx, ctx, {
      id: followUpId,
      enquiryId: row.enquiryId,
      doneAt,
    });
    return { ok: true };
  });
}
