import { asUserId } from "@/lib/ids";
import { eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { recordOpsAudit } from "./ops-action";
import { withPlatform } from "./scope";
import { platformSessions } from "./schema";
import {
  actorMayOperate,
  lockAdministratorSet,
  lockOperator,
  normaliseOperatorReason,
  requireAuditedContext,
  writeNoopEvidence,
  writeRefusalEvidence,
  type OperatorMutationOutcome,
} from "./platform-operators-shared";

const SCOPE = "operator.session.revoke" as const;
const SCOPE_ALL = "operator.session.revoke_all" as const;

/** End one operator session, with a reason, in one transaction. */
export async function revokeOperatorSession(input: {
  actorId: string;
  sessionId: string;
  reason: string;
}): Promise<OperatorMutationOutcome> {
  const reason = normaliseOperatorReason(input.reason);
  if (reason === null) {
    // No transaction is opened: nothing was read and nothing was
    // written. The action layer records the invalid input.
    return { kind: "refused", reason: "invalid_reason" };
  }

  return await withPlatformTransaction(async (tx) => {
    await lockAdministratorSet(tx);
    const actor = await lockOperator(tx, input.actorId);
    if (!actorMayOperate(actor)) {
      await writeRefusalEvidence(tx, {
        action: SCOPE,
        actorId: asUserId(input.actorId),
        targetType: "platform_session",
        targetId: input.sessionId,
        refusal: "not_admin",
      });
      return { kind: "refused", reason: "not_admin" };
    }
    requireAuditedContext(SCOPE, input.actorId);

    const [session] = await tx
      .select({ id: platformSessions.id, expiresAt: platformSessions.expiresAt })
      .from(platformSessions)
      .where(eq(platformSessions.id, input.sessionId))
      .limit(1)
      .for("update");

    if (!session) {
      await writeNoopEvidence(tx, { scope: SCOPE, actorId: input.actorId, noop: "unknown_session", reason });
      return { kind: "noop", reason: "unknown_session" };
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      // The session had already ended. It is left alone and the
      // operation is recorded as a no-op, not as a revocation.
      await writeNoopEvidence(tx, { scope: SCOPE, actorId: input.actorId, noop: "expired_session", reason, expiredSessions: 1 });
      return { kind: "noop", reason: "expired_session", expiredSessions: 1 };
    }

    await tx.delete(platformSessions).where(eq(platformSessions.id, session.id));
    await recordOpsAudit(tx, {
      action: SCOPE,
      actorId: asUserId(input.actorId),
      targetType: "platform_session",
      targetId: session.id,
      detail: { outcome: "success", revokedSessions: 1, reason },
    });
    return {
      kind: "applied",
      changed: 1,
      revokedSessions: 1,
      expiredSessions: 0,
    };
  });
}

/** End every LIVE session of one operator, with a reason, in one transaction. */
export async function revokeAllOperatorSessions(input: {
  actorId: string;
  operatorId: string;
  reason: string;
}): Promise<OperatorMutationOutcome> {
  const reason = normaliseOperatorReason(input.reason);
  if (reason === null) {
    return { kind: "refused", reason: "invalid_reason" };
  }

  return await withPlatformTransaction(async (tx) => {
    await lockAdministratorSet(tx);
    const actor = await lockOperator(tx, input.actorId);
    if (!actorMayOperate(actor)) {
      await writeRefusalEvidence(tx, {
        action: SCOPE_ALL,
        actorId: asUserId(input.actorId),
        targetType: "platform_user",
        targetId: input.operatorId,
        refusal: "not_admin",
      });
      return { kind: "refused", reason: "not_admin" };
    }
    requireAuditedContext(SCOPE_ALL, input.actorId);

    const target = await lockOperator(tx, input.operatorId);
    if (!target) {
      await writeRefusalEvidence(tx, {
        action: SCOPE_ALL,
        actorId: asUserId(input.actorId),
        targetType: "platform_user",
        targetId: input.operatorId,
        refusal: "unknown_operator",
      });
      return { kind: "refused", reason: "unknown_operator" };
    }

    const sessions = await tx
      .select({ id: platformSessions.id, expiresAt: platformSessions.expiresAt })
      .from(platformSessions)
      .where(eq(platformSessions.userId, input.operatorId))
      .for("update");

    const now = Date.now();
    const live = sessions.filter((row) => row.expiresAt.getTime() > now);
    const expired = sessions.length - live.length;

    if (live.length === 0) {
      await writeNoopEvidence(tx, { scope: SCOPE_ALL, actorId: input.actorId, noop: "no_live_sessions", reason, expiredSessions: expired });
      return { kind: "noop", reason: "no_live_sessions", expiredSessions: expired };
    }

    await tx
      .delete(platformSessions)
      .where(inArray(platformSessions.id, live.map((row) => row.id)));
    await recordOpsAudit(tx, {
      action: SCOPE_ALL,
      actorId: asUserId(input.actorId),
      targetType: "platform_user",
      targetId: input.operatorId,
      detail: {
        outcome: "success",
        count: live.length,
        revokedSessions: live.length,
        expiredSessions: expired,
        reason,
      },
    });
    return {
      kind: "applied",
      changed: live.length,
      revokedSessions: live.length,
      expiredSessions: expired,
    };
  });
}

/** The platform scope around the transaction. */
async function withPlatformTransaction<T>(
  fn: (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ) => Promise<T>,
): Promise<T> {
  return await withPlatform(() => db.transaction(fn));
}
