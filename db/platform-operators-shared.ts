import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import {
  currentOpsActorId,
  currentOpsScope,
  currentOpsTenantId,
  recordOpsAudit,
  type OpsScope,
} from "./ops-action";
import { platformUsers } from "./schema";
import { asUserId } from "@/lib/ids";

export const OPERATOR_REASON_MAX = 500;

export type OperatorRole = "admin" | "viewer";
export type OperatorStatus = "active" | "suspended";

/** Why a maintenance operation was refused. Every refusal is named. */
export type OperatorRefusal =
  | "not_admin"
  | "self_mutation"
  | "last_admin"
  | "unknown_operator"
  | "invalid_reason";

/** Why a maintenance operation changed nothing. */
export type OperatorNoopReason =
  | "no_sessions"
  | "no_live_sessions"
  | "already_in_state"
  | "unknown_session"
  | "expired_session";

/**
 * The outcome of a maintenance operation.
 *
 * `applied` — something changed, and the audit row says so.
 * `noop`    — nothing changed, and the audit row says THAT.
 * `refused` — nothing changed, and the refusal is named.
 */
export type OperatorMutationOutcome =
  | {
      kind: "applied";
      changed: number;
      revokedSessions: number;
      /** Sessions left alone because they had already expired. */
      expiredSessions: number;
    }
  | { kind: "noop"; reason: OperatorNoopReason; expiredSessions?: number }
  | { kind: "refused"; reason: OperatorRefusal };

/** The transaction surface the in-transaction writers accept. */
export type OperatorTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LockedOperator = {
  id: string;
  role: string;
  status: string;
};

/** The reason, trimmed. Null when it is missing or too long. */
export function normaliseOperatorReason(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed.length < 1 || trimmed.length > OPERATOR_REASON_MAX) return null;
  return trimmed;
}

/**
 * Lock the whole administrator set, in a deterministic order.
 *
 * Every administrator row is locked, ordered by id, so two concurrent
 * maintenance transactions serialise instead of deadlocking. The rows
 * returned are the LOCKED rows: the evaluation uses them, so it sees
 * the state the lock holds and not a preflight count.
 */
export async function lockAdministratorSet(
  tx: OperatorTx,
): Promise<Array<{ id: string; status: string }>> {
  return await tx
    .select({ id: platformUsers.id, status: platformUsers.status })
    .from(platformUsers)
    .where(eq(platformUsers.role, "admin"))
    .orderBy(asc(platformUsers.id))
    .for("update");
}

/** Lock and read one operator row. */
export async function lockOperator(
  tx: OperatorTx,
  id: string,
): Promise<LockedOperator | undefined> {
  const [row] = await tx
    .select({
      id: platformUsers.id,
      role: platformUsers.role,
      status: platformUsers.status,
    })
    .from(platformUsers)
    .where(eq(platformUsers.id, id))
    .limit(1)
    .for("update");
  return row;
}

/**
 * R4 — the live actor check.
 *
 * The actor's row is re-read here, inside the transaction, from the
 * database: never from the request, never from the form, never from
 * the cookie.
 */
export function actorMayOperate(actor: LockedOperator | undefined): actor is LockedOperator {
  return actor?.role === "admin" && actor.status === "active";
}

/**
 * R7 — would this change leave the platform with no active
 * administrator?
 *
 * Evaluated on the LOCKED set. In practice R5 (the self-mutation
 * refusal) and R4 (the live actor re-read) refuse first: an actor
 * whose own administrator rights were removed concurrently is refused
 * as a non-administrator before this is reached. The branch stays as
 * the last line of defence, and it is honest about being one.
 */
export function wouldLeaveNoActiveAdministrator(
  administrators: Array<{ id: string; status: string }>,
  targetId: string,
): boolean {
  const active = administrators.filter((row) => row.status === "active");
  const targetIsActive = active.some((row) => row.id === targetId);
  return targetIsActive && active.length - 1 <= 0;
}

/**
 * The audited-operation guard.
 *
 * A write that CHANGES something needs an ambient operation context:
 * the audit row's scope, actor and before/after are bound to it, and
 * `recordOpsAudit` only copies `before`/`after` into the row when one
 * exists. The guard therefore fails CLOSED — it throws rather than
 * writing an audit row that is not bound to the operation.
 *
 * A refusal needs no context: it changes nothing, and its evidence
 * names the actor itself.
 */
export function requireAuditedContext(scope: OpsScope, actorId: string): void {
  const ambientScope = currentOpsScope();
  if (ambientScope !== scope) {
    throw new Error(
      `operator maintenance requires the ${scope} operation context ` +
        `(ambient: ${ambientScope ?? "none"})`,
    );
  }
  if (currentOpsTenantId() !== null) {
    throw new Error("operator maintenance requires a global operation context");
  }
  const ambientActor = currentOpsActorId();
  if (String(ambientActor ?? "") !== actorId) {
    throw new Error("operator maintenance requires its own actor context");
  }
}

/** Record the no-op cause and reason after validating the global actor context. */
export async function writeNoopEvidence(
  tx: OperatorTx,
  input: { scope: OpsScope; actorId: string; noop: OperatorNoopReason; reason: string; expiredSessions?: number },
): Promise<void> {
  requireAuditedContext(input.scope, input.actorId);
  await recordOpsAudit(tx, {
    action: input.scope,
    actorId: asUserId(input.actorId),
    detail: {
      outcome: "noop",
      noop: input.noop,
      reason: input.reason,
      correlationId: randomUUID(),
      origin: "server_action",
      ...(input.expiredSessions === undefined ? {} : { expiredSessions: input.expiredSessions }),
    },
  });
}

/**
 * R7/F7 — the refusal evidence.
 *
 * A refusal changes nothing, and it is recorded as a refusal IN THE
 * SAME TRANSACTION: a privileged attempt that was refused — an actor
 * whose administrator rights were removed concurrently, a self
 * demotion, an unknown target — leaves a trace in
 * `platform_audit_log` instead of vanishing.
 */
export async function writeRefusalEvidence(
  tx: OperatorTx,
  input: {
    action: OpsScope;
    actorId: string;
    targetType: string;
    targetId: string | null;
    refusal: OperatorRefusal;
  },
): Promise<void> {
  await recordOpsAudit(tx, {
    action: input.action,
    actorId: asUserId(input.actorId),
    targetType: input.targetType,
    targetId: input.targetId,
    detail: { outcome: "denied", refusal: input.refusal },
  });
}
