import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enrolments } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { visibleBatch, visibleMember } from "./resource-access";
import { auditActorOf, writeAudit } from "@/lib/audit/write";

export type TransferBatchResult =
  | { kind: "ok"; fromBatchId: string; toBatchId: string }
  | { kind: "error"; code: "invalid" | "not_enrolled_in_source" | "already_enrolled_in_target" | "target_full" | "batch_not_found"; message: string };

export async function transferMemberToBatch(ctx: ActionCtx, input: {
  memberId: string; fromBatchId: string; toBatchId: string;
}): Promise<TransferBatchResult> {
  if (input.fromBatchId === input.toBatchId) return { kind: "error", code: "invalid", message: "Source and destination batches are the same." };
  return withTenant(ctx.tenantId, async tx => {
    // Stable lock order prevents opposite-direction transfers deadlocking.
    await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.tenantId, ctx.tenantId),
      inArray(batches.id, [input.fromBatchId, input.toBatchId]))).orderBy(asc(batches.id)).for("update");
    const source = await visibleBatch(tx, ctx, input.fromBatchId);
    const dest = await visibleBatch(tx, ctx, input.toBatchId);
    const member = await visibleMember(tx, ctx, input.memberId);
    if (!source || !dest || !member) return { kind: "error", code: "batch_not_found", message: "Member or batch not found." };
    const sourceRows = await tx.select().from(enrolments).where(and(eq(enrolments.tenantId, ctx.tenantId),
      eq(enrolments.memberId, asMemberId(input.memberId)), eq(enrolments.batchId, source.id))).for("update");
    if (!sourceRows.length) return { kind: "error", code: "not_enrolled_in_source", message: "Member is not enrolled in the source batch." };
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant.timezone);
    const [existing] = await tx.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.tenantId, ctx.tenantId),
      eq(enrolments.memberId, member.id), eq(enrolments.batchId, dest.id))).limit(1);
    if (existing) return { kind: "error", code: "already_enrolled_in_target", message: "Member is already enrolled in the destination batch." };
    const [{ n }] = await tx.select({ n: sql<number>`count(distinct ${enrolments.memberId})::int` }).from(enrolments)
      .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, dest.id)));
    if (n >= dest.capacity) return { kind: "error", code: "target_full", message: `Destination batch is full (capacity ${dest.capacity}).` };
    // All refusal checks precede writes, preserving exact source rows on failure.
    await tx.delete(enrolments).where(inArray(enrolments.id, sourceRows.map(row => row.id)));
    const [inserted] = await tx.insert(enrolments).values({ tenantId: ctx.tenantId, memberId: member.id,
      batchId: dest.id, enrolledOn: today, createdBy: ctx.userId, updatedBy: ctx.userId }).returning({ id: enrolments.id });
    await writeAudit(tx, { tenantId: ctx.tenantId, ...auditActorOf(ctx),
      action: "member.transfer", entityType: "member", entityId: member.id,
      before: { enrolments: sourceRows.map(row => ({ id: row.id, batchId: row.batchId, enrolledOn: row.enrolledOn })) },
      after: { enrolmentId: inserted.id, batchId: dest.id, enrolledOn: today } });
    return { kind: "ok", fromBatchId: source.id, toBatchId: dest.id };
  });
}
