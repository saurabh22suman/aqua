import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { db } from "./client";
import { withPlatform } from "./scope";
import { platformAuditLog } from "./schema/platform-users";

/** The transaction surface the in-tx writer needs; a savepoint satisfies it too. */
type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The FIXED code of the alert emitted when an auth event cannot be written. */
export const OPS_AUTH_AUDIT_ALERT_CODE = "ops.auth.audit_write_failed";

/**
 * The FIXED codes an unexpected failure is classified with.
 *
 * An exception's `name` is mutable and unbounded: any thrower can set it
 * and it can carry data. The classification therefore COMPARES the name
 * against a closed allowlist and returns a code from that same closed set.
 * The driver is compared the same way: a node-postgres failure carries a
 * SQLSTATE on `code`, and the code is READ to classify, never COPIED.
 */
export const OPS_AUTH_UNEXPECTED_ERROR_CODES = ["db_error", "unknown_error"] as const;
export type OpsAuthUnexpectedErrorCode = (typeof OPS_AUTH_UNEXPECTED_ERROR_CODES)[number];

const DRIVER_ERROR_NAMES = new Set(["DrizzleQueryError", "DatabaseError", "PostgresError"]);

export function classifyUnexpectedError(error: unknown): OpsAuthUnexpectedErrorCode {
  if (error instanceof Error) {
    if (DRIVER_ERROR_NAMES.has(error.name)) return "db_error";
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return "db_error";
  }
  return "unknown_error";
}

/**
 * The alert for an audit-store failure.
 *
 * The audit store is the thing that just failed, so the alert cannot live
 * in it. It goes to the process log with a FIXED code and a FIXED set of
 * keys: the phase, the outcome where there is one, the pseudonymous
 * identity hash where there is one, and the correlation id of the attempt.
 * Nothing from the exception and nothing from the request is copied — an
 * exception name is mutable and may carry data.
 *
 * The alert records the LOSS. It never changes the operation's outcome: a
 * refusal stays refused, and an already committed outcome is never
 * replaced by a retryable failure.
 */
export function emitOpsAuthAuditAlert(input: {
  phase: string;
  outcome?: string;
  identityHash?: string;
  correlationId: string;
}): void {
  console.error("[ops-auth] auth audit event write failed", {
    code: OPS_AUTH_AUDIT_ALERT_CODE,
    phase: input.phase,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.identityHash ? { identityHash: input.identityHash } : {}),
    correlationId: input.correlationId,
  });
}

/**
 * The pseudonymous key an identity is recorded under. The raw login email
 * is never written to an event (docs/ops-authenticator-cutover.md: "raw
 * login emails are not written to these events"); the key is stable across
 * replicas and rotates with BETTER_AUTH_SECRET.
 */
export function opsIdentityHash(phase: string, identity: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET ?? "ops-attempt-development-only")
    .update(`ops-login:${phase}:${identity.trim().toLowerCase()}`).digest("hex");
}

/**
 * Records ONE auth event in its own transaction.
 *
 * These are OBSERVATIONS, not mutations. An attempt that is refused before
 * any credential check (malformed input, a missing challenge) and an
 * attempt that fails with an unexpected internal error must still be
 * visible to an operator, and the attempt transaction cannot carry them:
 * it rolls back, and takes its evidence with it.
 */
export async function recordPlatformAuthEvent(input: {
  action: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
  actorId?: string | null;
}): Promise<void> {
  await withPlatform(() =>
    db.insert(platformAuditLog).values({
      action: input.action,
      actorId: input.actorId ?? null,
      ipAddress: input.ipAddress,
      detail: input.detail ?? {},
      createdAt: new Date(),
    }),
  );
}

/**
 * Writes an auth event, or ALERTS when the store is unavailable.
 *
 * The outcome of the operation never depends on this write: a denial
 * stays denied, and an already committed outcome is never replaced by a
 * retryable failure. But the loss is never silent — a store failure
 * produces a fixed, safe, correlated alert (see
 * emitOpsAuthAuditAlert) instead of a swallowed exception.
 *
 * WHERE IT IS USED. The known-account failure row is written through this
 * writer with `tx`: one savepoint inside the attempt transaction, so a
 * store failure cannot abort the caller's credential refusal. Without
 * `tx` it keeps its own transaction for non-transactional callers.
 *
 * The other auth observations have their own correct boundaries: the
 * signed-in success row is a direct insert in the same transaction as the
 * session/TOTP mutation (a failure must roll that success back), and every
 * unauthenticated surface event goes through the bounded pre-auth writers
 * in db/platform-auth-preauth.ts (which alert the same way).
 */
export async function writeAuthEventOrAlert(input: {
  action: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
  actorId?: string | null;
  phase: string;
  outcome?: string;
  identityHash?: string;
  correlationId: string;
  /** Write inside the caller's transaction (a savepoint); omit for its own. */
  tx?: AuditTx;
}): Promise<void> {
  try {
    if (input.tx) {
      await input.tx.transaction(async (savepoint) => {
        await savepoint.insert(platformAuditLog).values({
          action: input.action,
          actorId: input.actorId ?? null,
          ipAddress: input.ipAddress,
          detail: input.detail ?? {},
          createdAt: new Date(),
        });
      });
    } else {
      await recordPlatformAuthEvent(input);
    }
  } catch {
    emitOpsAuthAuditAlert({
      phase: input.phase,
      outcome: input.outcome,
      identityHash: input.identityHash,
      correlationId: input.correlationId,
    });
  }
}
