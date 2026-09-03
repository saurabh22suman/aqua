import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { enrolments } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

// Phase R.6 — V.19 batch transfer. Move a member from one
// batch to another within a tenant, preserving attendance
// history (which is keyed to specific sessions, not to the
// enrolment) and the audit trail.
//
// "Subscription" mentioned in the work-guide text doesn't
// exist as a table yet — V-30's domain is on the build
// roadmap but not in this five-day batch. The transfer here
// works against the enrolment row only, with a comment
// pointing at the future subscription service when it lands.
//
// Enrolments is hard-deleted from the source (the table is
// append-only in the sense that rows aren't versioned; the
// unique key on (tenant, member, batch, day) makes soft-delete
// unnecessary). The auditColumns updatedAt / updatedBy on the
// remaining rows still carry the change. Attendance rows
// reference session_id, not enrolment, so historical
// attendance reads stay intact.

export type TransferBatchResult =
  | { kind: "ok"; fromBatchId: string; toBatchId: string }
  | {
      kind: "error";
      code:
        | "invalid"
        | "not_enrolled_in_source"
        | "already_enrolled_in_target"
        | "target_full"
        | "batch_not_found";
      message: string;
    };

export async function transferMemberToBatch(
  ctx: ActionCtx,
  input: {
    memberId: string;
    fromBatchId: string;
    toBatchId: string;
  },
): Promise<TransferBatchResult> {
  if (input.fromBatchId === input.toBatchId) {
    return {
      kind: "error",
      code: "invalid",
      message: "Source and destination batches are the same.",
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [dest] = await tx
      .select({ id: batches.id, capacity: batches.capacity })
      .from(batches)
      .where(
        and(
          eq(batches.id, input.toBatchId),
          eq(batches.tenantId, ctx.tenantId),
          sql`${batches.deletedAt} is null`,
        ),
      )
      .for("update");
    if (!dest) {
      return {
        kind: "error",
        code: "batch_not_found",
        message: "Destination batch not found.",
      };
    }

    const sourceRows = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(input.memberId)),
          eq(enrolments.batchId, input.fromBatchId),
        ),
      );
    if (sourceRows.length === 0) {
      return {
        kind: "error",
        code: "not_enrolled_in_source",
        message: "Member is not enrolled in the source batch.",
      };
    }

    await tx
      .delete(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(input.memberId)),
          eq(enrolments.batchId, input.fromBatchId),
        ),
      );

    const today = new Date().toISOString().slice(0, 10);
    const [{ n: destCount }] = await tx
      .select({ n: sql<number>`count(distinct ${enrolments.memberId})::int` })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.batchId, input.toBatchId),
        ),
      );
    if (destCount >= dest.capacity) {
      // Reinsert into the source so the member isn't left
      // orphaned by a failed transfer.
      await tx.insert(enrolments).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        memberId: asMemberId(input.memberId),
        batchId: input.fromBatchId,
        enrolledOn: today,
        createdBy: ctx.userId as never,
        updatedBy: ctx.userId as never,
      });
      return {
        kind: "error",
        code: "target_full",
        message: `Destination batch is full (capacity ${dest.capacity}).`,
      };
    }

    const [existing] = await tx
      .select({ id: enrolments.id })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(input.memberId)),
          eq(enrolments.batchId, input.toBatchId),
          eq(enrolments.enrolledOn, today),
        ),
      )
      .limit(1);
    if (existing) {
      await tx.insert(enrolments).values({
        id: uuidv7(),
        tenantId: ctx.tenantId,
        memberId: asMemberId(input.memberId),
        batchId: input.fromBatchId,
        enrolledOn: today,
        createdBy: ctx.userId as never,
        updatedBy: ctx.userId as never,
      });
      return {
        kind: "error",
        code: "already_enrolled_in_target",
        message: "Member is already enrolled in the destination batch today.",
      };
    }

    await tx.insert(enrolments).values({
      id: uuidv7(),
      tenantId: ctx.tenantId,
      memberId: asMemberId(input.memberId),
      batchId: input.toBatchId,
      enrolledOn: today,
      createdBy: ctx.userId as never,
      updatedBy: ctx.userId as never,
    });

    return {
      kind: "ok",
      fromBatchId: input.fromBatchId,
      toBatchId: input.toBatchId,
    };
  });
}
