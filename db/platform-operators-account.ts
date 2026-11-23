import { asUserId } from "@/lib/ids";
import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { recordOpsAudit } from "./ops-action";
import { withPlatform } from "./scope";
import { platformSessions, platformUsers } from "./schema";
import {
  actorMayOperate,
  lockAdministratorSet,
  lockOperator,
  normaliseOperatorReason,
  requireAuditedContext,
  wouldLeaveNoActiveAdministrator,
  writeNoopEvidence,
  writeRefusalEvidence,
  type OperatorMutationOutcome,
  type OperatorRole,
  type OperatorStatus,
} from "./platform-operators-shared";

const ROLE_SCOPE = "operator.role.update" as const;
const STATUS_SCOPE = "operator.status.update" as const;

/** Change one operator account's role. */
export async function setOperatorRole(input: {
  actorId: string;
  operatorId: string;
  role: OperatorRole;
  reason: string;
}): Promise<OperatorMutationOutcome> {
  return await changeOperatorAccount({
    actorId: asUserId(input.actorId),
    operatorId: input.operatorId,
    reason: input.reason,
    change: "role",
    value: input.role,
  });
}

/** Change one operator account's status. */
export async function setOperatorStatus(input: {
  actorId: string;
  operatorId: string;
  status: OperatorStatus;
  reason: string;
}): Promise<OperatorMutationOutcome> {
  return await changeOperatorAccount({
    actorId: asUserId(input.actorId),
    operatorId: input.operatorId,
    reason: input.reason,
    change: "status",
    value: input.status,
  });
}

/**
 * The one implementation of a bounded account change.
 *
 * `value` is required and always passed explicitly by the two wrappers
 * above — it is the value the row is moved TO, and it is compared with
 * the row's current value to decide whether anything changes at all.
 */
async function changeOperatorAccount(input: {
  actorId: string;
  operatorId: string;
  reason: string;
  change: "role" | "status";
  value: OperatorRole | OperatorStatus;
}): Promise<OperatorMutationOutcome> {
  const reason = normaliseOperatorReason(input.reason);
  if (reason === null) {
    return { kind: "refused", reason: "invalid_reason" };
  }

  const isRole = input.change === "role";
  const scope = isRole ? ROLE_SCOPE : STATUS_SCOPE;

  return await withPlatform(() =>
    db.transaction(async (tx) => {
      const administrators = await lockAdministratorSet(tx);
      const actor = await lockOperator(tx, input.actorId);
      if (!actorMayOperate(actor)) {
        await writeRefusalEvidence(tx, {
          action: scope,
          actorId: asUserId(input.actorId),
          targetType: "platform_user",
          targetId: input.operatorId,
          refusal: "not_admin",
        });
        return { kind: "refused", reason: "not_admin" };
      }
      requireAuditedContext(scope, input.actorId);

      const target = await lockOperator(tx, input.operatorId);
      if (!target) {
        await writeRefusalEvidence(tx, {
          action: scope,
          actorId: asUserId(input.actorId),
          targetType: "platform_user",
          targetId: input.operatorId,
          refusal: "unknown_operator",
        });
        return { kind: "refused", reason: "unknown_operator" };
      }

      const current = isRole ? target.role : target.status;
      if (current === input.value) {
        // R3 — a change that changes nothing is a no-op, and says so.
        await writeNoopEvidence(tx, { scope, actorId: input.actorId, noop: "already_in_state", reason });
        return { kind: "noop", reason: "already_in_state" };
      }

      // R5 — an operator may not change their own role or status.
      if (target.id === actor.id) {
        await writeRefusalEvidence(tx, {
          action: scope,
          actorId: asUserId(input.actorId),
          targetType: "platform_user",
          targetId: target.id,
          refusal: "self_mutation",
        });
        return { kind: "refused", reason: "self_mutation" };
      }

      // R7 — evaluated on the locked set, after the lock.
      if (wouldLeaveNoActiveAdministrator(administrators, target.id)) {
        await writeRefusalEvidence(tx, {
          action: scope,
          actorId: asUserId(input.actorId),
          targetType: "platform_user",
          targetId: target.id,
          refusal: "last_admin",
        });
        return { kind: "refused", reason: "last_admin" };
      }

      // R6 — the target's sessions end with the change.
      const sessions = await tx
        .select({ id: platformSessions.id, expiresAt: platformSessions.expiresAt })
        .from(platformSessions)
        .where(eq(platformSessions.userId, target.id))
        .for("update");

      const now = Date.now();
      const liveIds = sessions.filter((session) => session.expiresAt.getTime() > now).map((session) => session.id);
      const expiredSessions = sessions.length - liveIds.length;

      if (isRole) {
        await tx
          .update(platformUsers)
          .set({ role: input.value as OperatorRole, updatedAt: new Date() })
          .where(eq(platformUsers.id, target.id));
      } else {
        await tx
          .update(platformUsers)
          .set({ status: input.value as OperatorStatus, updatedAt: new Date() })
          .where(eq(platformUsers.id, target.id));
      }

      if (liveIds.length > 0) {
        await tx
          .delete(platformSessions)
          .where(inArray(platformSessions.id, liveIds));
      }

      await recordOpsAudit(tx, {
        action: scope,
        actorId: asUserId(input.actorId),
        targetType: "platform_user",
        targetId: target.id,
        before: isRole ? { role: target.role } : { status: target.status },
        after: isRole ? { role: input.value } : { status: input.value },
        detail: {
          outcome: "success",
          revokedSessions: liveIds.length,
          expiredSessions,
          reason,
        },
      });
      return {
        kind: "applied",
        changed: 1,
        revokedSessions: liveIds.length,
        expiredSessions,
      };
    }),
  );
}
