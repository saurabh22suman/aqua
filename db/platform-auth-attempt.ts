import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import type { TenantTx } from "./tenant";
import { platformAuditLog } from "./schema/platform-users";
import { PlatformAuthError } from "./platform-auth-crypto";
import {
  classifyUnexpectedError,
  opsIdentityHash,
  writeAuthEventOrAlert,
} from "./platform-auth-audit";
import { recordUnauthEvent, recordUnauthEventInTx } from "./platform-auth-preauth";

export type LoginMeta = { ipAddress?: string; userAgent?: string };
export const OPS_ATTEMPT_WINDOW_MS = 15 * 60_000;
export const OPS_ACCOUNT_ATTEMPTS = 5;
export const OPS_ADDRESS_ATTEMPTS = 20;

/**
 * Which budget an attempt spends.
 *
 * "operator" is the budget that protects a known operator's sign-in: the
 * account budget and the address budget, counted from the
 * `platform.login.failed` rows.
 *
 * "unknown_challenge" is the budget for a TOTP attempt whose session is
 * NOT known. It is SEPARATE on purpose: an unauthenticated caller must not
 * be able to spend the budget that protects a real operator's sign-in.
 * A challenge that names no account is therefore counted and capped on its
 * own key and its own action, and it can never consume the operator's
 * budget.
 *
 * The trade-off this accepts: the unknown budget is keyed on the address,
 * and the address is only as trustworthy as the ingress (see the trusted
 * ingress precondition in the proposal). If the address is spoofable, an
 * attacker can evade this budget by rotating the header — but because the
 * budget is separate, they still cannot lock an operator out of their own
 * sign-in. Users behind one shared NAT share this budget with each other:
 * that is a nuisance for unknown challenges, never an operator lock-out.
 *
 * The policy is a CHOSEN one and the human approves it explicitly: an
 * unknown challenge from one address COUNTS against that address's unknown
 * budget. The alternative — not counting it — is not obviously safer: an
 * attacker who sprays KNOWN phone numbers from a shared NAT exhausts the
 * known-account budget in exactly the same way, and the address-keyed
 * limit would then be bypassed entirely. What matters is that the
 * declared behaviour and the code agree, and that both are stated.
 */
export type AttemptBudget = "operator" | "unknown_challenge";
/** Persistent, transaction-serialized attempt control; no process-local counter. */
export async function runPlatformLoginAttempt<T>(
  phase: "password" | "totp",
  identity: string,
  meta: LoginMeta,
  authenticate: (tx: TenantTx) => Promise<{ value: T; actorId: string; totpStep?: number }>,
  options?: { budget?: AttemptBudget },
): Promise<T> {
  const identityHash = opsIdentityHash(phase, identity);
  const ipAddress = meta.ipAddress && isIP(meta.ipAddress) ? meta.ipAddress : undefined;
  // One correlation id per attempt: it ties the attempt's events (and the
  // alert for a failed one) to each other without carrying any value from
  // the request.
  const correlationId = randomUUID();
  let outcome: { value: T } | { error: PlatformAuthError };
  try {
    outcome = await runAttemptTransaction(
      phase,
      identityHash,
      ipAddress,
      correlationId,
      authenticate,
      options?.budget ?? "operator",
    );
  } catch (error) {
    // The attempt transaction rolled back, so it holds no evidence of the
    // attempt at all. Record the unexpected failure separately, then let
    // the ORIGINAL error reach the caller: a failed event write must not
    // replace it. The row is an UNAUTHENTICATED-CALLER-WRITABLE event, so
    // it goes through the pre-auth budget like every other one.
    await recordUnauthEvent({
      action: "platform.login.error",
      detail: {
        phase,
        identityHash,
        correlationId,
        // A FIXED code, never the exception: its name is mutable and may
        // carry data, and its message may carry a value.
        errorCode: classifyUnexpectedError(error),
      },
      ipAddress,
      phase,
      outcome: "unexpected_error",
      identityHash,
      correlationId,
    });
    throw error;
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}

// The attempt transaction itself: the account and the address limiters, the
// credential check and the success/failure events, in ONE transaction so
// the limit counters cannot race. It throws for anything that is not a
// PlatformAuthError; the caller above records that as an unexpected error.
async function runAttemptTransaction<T>(
  phase: "password" | "totp",
  identityHash: string,
  ipAddress: string | undefined,
  correlationId: string,
  authenticate: (tx: TenantTx) => Promise<{ value: T; actorId: string; totpStep?: number }>,
  budget: AttemptBudget,
): Promise<{ value: T } | { error: PlatformAuthError }> {
  // The unknown-challenge budget has its OWN action and its OWN address
  // key, so it can never consume the budget that protects a known
  // operator's sign-in.
  const unknown = budget === "unknown_challenge";
  const failureAction = unknown ? "platform.login.failed.unknown" : "platform.login.failed";
  const throttledAction = unknown ? "platform.login.throttled.unknown" : "platform.login.throttled";
  return withPlatform(() => db.transaction(async tx => {
    const locks = [`ops-account:${identityHash}`];
    if (ipAddress) {
      locks.push(
        unknown
          ? `ops-address:${phase}-unknown:${ipAddress}`
          : `ops-address:${phase}:${ipAddress}`,
      );
    }
    // The attempt transaction starts with only the account/address locks. The
    // bounded budget-owned insert helper takes the global admission lock
    // immediately before its count+insert — never around authenticate().
    // The helper runs after this lock loop, so admission is always taken
    // after account/address; the own-transaction writer takes it alone.
    for (const key of locks.sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    }
    const [attempts] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(platformAuditLog).where(and(
        eq(platformAuditLog.action, failureAction),
        gte(platformAuditLog.createdAt, new Date(Date.now() - OPS_ATTEMPT_WINDOW_MS)),
        sql`${platformAuditLog.detail}->>'identityHash' = ${identityHash}`,
        sql`${platformAuditLog.detail}->>'phase' = ${phase}`,
      ));
    const [addressAttempts] = ipAddress ? await tx.select({ count: sql<number>`count(*)::int` })
      .from(platformAuditLog).where(and(
        eq(platformAuditLog.action, failureAction),
        eq(platformAuditLog.ipAddress, ipAddress),
        gte(platformAuditLog.createdAt, new Date(Date.now() - OPS_ATTEMPT_WINDOW_MS)),
        sql`${platformAuditLog.detail}->>'phase' = ${phase}`,
      )) : [];
    if ((attempts?.count ?? 0) >= OPS_ACCOUNT_ATTEMPTS || (addressAttempts?.count ?? 0) >= OPS_ADDRESS_ATTEMPTS) {
      // The throttle event is written by an unauthenticated caller in
      // BOTH budgets, so it goes through the SAME budget-owned insert:
      // once the window's pre-auth budget is spent, this row is not
      // written either — the caller still gets the rate-limited answer.
      await recordUnauthEventInTx(tx, {
        action: throttledAction,
        ipAddress,
        detail: { phase, identityHash, correlationId, budget },
        phase,
        outcome: "throttled",
        identityHash,
        correlationId,
      });
      return { error: new PlatformAuthError("rate_limited", "Sign-in is temporarily unavailable. Try again later.") };
    }
    try {
      // A failed authentication rolls back its own mutations, while the
      // outer transaction can commit a safe failure event.
      const { value, actorId, totpStep } = await tx.transaction(authenticate);
      await tx.insert(platformAuditLog).values({
        actorId, action: phase === "totp" ? "platform.login" : "platform.login.password_passed", ipAddress,
        detail: { phase, identityHash, correlationId, method: phase === "totp" ? "password_totp" : "password",
          ...(totpStep === undefined ? {} : { totpStep }) }, createdAt: new Date(),
      });
      return { value };
    } catch (error) {
      if (!(error instanceof PlatformAuthError)) throw error;
      // The reason makes a DENIAL distinguishable from a wrong password:
      // "user_suspended" and "no_totp" refuse the ACCOUNT,
      // "invalid_credentials" is a wrong secret. The code is a closed
      // union — never a message, never a value.
      const failureDetail: Record<string, unknown> = {
        phase, identityHash, correlationId, reason: error.code,
      };
      if (unknown) {
        // The UNKNOWN budget's failure row is written by an
        // unauthenticated caller, so the SAME budget-owned insert writes
        // it: an exhausted window writes NOTHING here — the per-address
        // unknown cap stops advancing — and the caller still gets the refusal.
        await recordUnauthEventInTx(tx, {
          action: failureAction,
          ipAddress,
          detail: failureDetail,
          phase,
          outcome: error.code,
          identityHash,
          correlationId,
        });
        return { error };
      }
      // The KNOWN-ACCOUNT failure is not pre-auth-budget-owned: it is
      // bounded by the account/address attempt caps. It is still written
      // inside the attempt transaction (so the caps cannot race), but in a
      // SAVEPOINT: a store failure must not replace the credential refusal
      // with an internal error. The shared writer alerts the loss.
      await writeAuthEventOrAlert({
        action: failureAction,
        ipAddress,
        detail: failureDetail,
        phase,
        outcome: error.code,
        identityHash,
        correlationId,
        tx,
      });
      return { error };
    }
  }));
}

// Compatibility re-exports for existing importers of this module.
export {
  OPS_AUTH_AUDIT_ALERT_CODE,
  OPS_AUTH_UNEXPECTED_ERROR_CODES,
  classifyUnexpectedError,
  emitOpsAuthAuditAlert,
  opsIdentityHash,
  recordPlatformAuthEvent,
  writeAuthEventOrAlert,
} from "./platform-auth-audit";
export type { OpsAuthUnexpectedErrorCode } from "./platform-auth-audit";
export {
  OPS_PREAUTH_WINDOW_MS,
  OPS_PREAUTH_ADDRESS_BUDGET,
  OPS_PREAUTH_GLOBAL_BUDGET,
  OPS_PREAUTH_ADMISSION_LOCK,
  OPS_PREAUTH_MARKER,
  OPS_PREAUTH_REJECTED,
  OPS_PREAUTH_LOGOUT_NOOP,
  OPS_PREAUTH_AGGREGATE,
  OPS_PREAUTH_EXHAUSTED,
  recordUnauthEvent,
  recordUnauthEventInTx,
} from "./platform-auth-preauth";
export type { UnauthWriteOutcome } from "./platform-auth-preauth";
