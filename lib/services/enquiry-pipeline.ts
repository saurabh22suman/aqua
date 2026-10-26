import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, enquiryFollowUps, type EnquiryStage } from "@/db/schema/enquiries";
import type { ActionCtx } from "@/lib/auth/context";
import { ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import {
  enquiryConditions,
  enquiryScope,
  visibleEnquiry,
} from "@/lib/services/enquiry-scope";

// C-13 — the enquiry pipeline: stage transitions and follow-ups.

export type StageResult = { ok: true } | { ok: false; error: string };

// C-13: stage transitions follow the same allowed-graph shape C-08
// uses for member status (lib/enquiry-stage-graph.ts). Not itself
// audited to a separate history table -- unlike member status, this
// wasn't asked for, and updated_at/updated_by already say who touched
// it last.
export async function transitionEnquiryStage(
  ctx: ActionCtx,
  input: { enquiryId: string; toStage: EnquiryStage },
): Promise<StageResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleEnquiry(tx, ctx, input.enquiryId);
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
      .select({ id: enquiryFollowUps.id })
      .from(enquiryFollowUps)
      .innerJoin(enquiries, eq(enquiries.id, enquiryFollowUps.enquiryId))
      .where(
        and(...enquiryConditions(ctx, predicate, [
          eq(enquiryFollowUps.id, followUpId),
          eq(enquiryFollowUps.tenantId, ctx.tenantId),
        ])),
      );
    if (!row) return { ok: false, error: "Follow-up not found." };

    await tx
      .update(enquiryFollowUps)
      .set({ doneAt: new Date(), updatedBy: ctx.userId })
      .where(eq(enquiryFollowUps.id, followUpId));
    return { ok: true };
  });
}
