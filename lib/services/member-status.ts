import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { members, memberStatusTransitions, type MemberStatus } from "@/db/schema/people";
import type { Ctx } from "@/lib/auth/context";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

// C-08's allowed graph. Nothing is a dead end -- "left" rejoins to
// "active" rather than being terminal, per the done-when: "each
// transition is audited and reversible."
const ALLOWED_TRANSITIONS: Record<MemberStatus, MemberStatus[]> = {
  trial: ["active", "lapsed", "left"],
  active: ["paused", "lapsed", "left"],
  paused: ["active", "left"],
  lapsed: ["active", "left"],
  left: ["active"],
};

export type TransitionResult = { ok: true } | { ok: false; error: string };

// The one writer of member_status_transitions (db/migrations/0016).
// Reason is required, not optional -- an unexplained status change
// defeats the point of an audit trail.
export async function transitionMemberStatus(
  ctx: ActionCtx,
  input: { memberId: string; toStatus: MemberStatus; reason: string },
): Promise<TransitionResult> {
  if (!input.reason.trim()) {
    return { ok: false, error: "A reason is required to change a member's status." };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [member] = await tx
      .select({ status: members.status })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.tenantId, ctx.tenantId)))
      .for("update");
    if (!member) return { ok: false, error: "Member not found." };

    const fromStatus = member.status as MemberStatus;
    if (fromStatus === input.toStatus) {
      return { ok: false, error: `Member is already ${input.toStatus}.` };
    }
    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(input.toStatus)) {
      return {
        ok: false,
        error: `Cannot move a member from ${fromStatus} to ${input.toStatus}.`,
      };
    }

    await tx
      .update(members)
      .set({ status: input.toStatus, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(members.id, input.memberId));

    await tx.insert(memberStatusTransitions).values({
      tenantId: ctx.tenantId,
      memberId: input.memberId,
      fromStatus,
      toStatus: input.toStatus,
      reason: input.reason,
      changedBy: ctx.userId,
    });

    return { ok: true };
  });
}

export function pauseMember(
  ctx: ActionCtx,
  memberId: string,
  reason: string,
): Promise<TransitionResult> {
  return transitionMemberStatus(ctx, { memberId, toStatus: "paused", reason });
}

export function resumeMember(
  ctx: ActionCtx,
  memberId: string,
  reason: string,
): Promise<TransitionResult> {
  return transitionMemberStatus(ctx, { memberId, toStatus: "active", reason });
}

export type MemberStatusHistoryRow = {
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  changedBy: string | null;
  changedAt: Date;
};

export async function listMemberStatusHistory(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberStatusHistoryRow[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        fromStatus: memberStatusTransitions.fromStatus,
        toStatus: memberStatusTransitions.toStatus,
        reason: memberStatusTransitions.reason,
        changedBy: memberStatusTransitions.changedBy,
        changedAt: memberStatusTransitions.changedAt,
      })
      .from(memberStatusTransitions)
      .where(
        and(
          eq(memberStatusTransitions.tenantId, ctx.tenantId),
          eq(memberStatusTransitions.memberId, memberId),
        ),
      )
      .orderBy(memberStatusTransitions.changedAt),
  );
}
