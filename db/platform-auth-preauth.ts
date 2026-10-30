import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "./client";
import { withPlatform } from "./scope";
import { platformAuditLog } from "./schema/platform-users";
import { emitOpsAuthAuditAlert } from "./platform-auth-audit";

// ---------------------------------------------------------------------------
// The PRE-AUTH budget.
//
// Every event an UNAUTHENTICATED caller can write carries
// `detail.unauthEvent = true`. That MARKER — not the action name — is
// what the counter reads, so a new unauthenticated event family cannot
// fall outside the budget by picking a different action name.
//
// The families inside the budget:
//
//   * platform.preauth.rejected        a malformed request, or a request
//                                      with no challenge
//   * platform.preauth.logout_noop      a sign-out with a missing or an
//                                      unknown session
//   * platform.preauth.aggregate        "further rejections of this address
//                                      were not individually recorded"
//   * platform.preauth.exhausted        "the window's budget is spent"
//   * platform.login.failed.unknown     a challenge whose session is not
//                                      known (written inside the attempt
//                                      transaction)
//   * platform.login.error              an unexpected internal failure
//
// The KNOWN-ACCOUNT FAILURE row is unauthenticated-writable but is NOT in
// this pre-auth budget: it is bounded by the account/address attempt
// budgets below. The AUTHENTICATED rows are outside it too.
//
// ONE LOCK, ONE BOUNDED INSERT
//   The bounded budget-owned insert helper takes the ONE global advisory
//   lock IMMEDIATELY before its count/aggregate/insert and releases it when
//   the surrounding transaction ends. Nothing else is inside: no credential
//   check, no network call, no caller work. Every budget-owned insert goes
//   through that helper, so the count and the write cannot interleave. The
//   attempt transaction holds only the account/address locks; the helper is
//   called after them, so admission is never taken before account/address.
//
// The bound for the BUDGET-OWNED rows is therefore EXACT under the lock.
// This revision does not claim a "small multiple": the count that is read
// is the count that is enforced.
export const OPS_PREAUTH_WINDOW_MS = 15 * 60_000;
export const OPS_PREAUTH_ADDRESS_BUDGET = 20;
export const OPS_PREAUTH_GLOBAL_BUDGET = 200;

/** The ONE lock the bounded budget-owned insert helper takes. */
export const OPS_PREAUTH_ADMISSION_LOCK = "ops-preauth-admission";

/** The marker that puts a row inside the pre-auth budget. */
export const OPS_PREAUTH_MARKER = "unauthEvent";

/** The action names of the pre-auth SURFACE events. */
export const OPS_PREAUTH_REJECTED = "platform.preauth.rejected";
export const OPS_PREAUTH_LOGOUT_NOOP = "platform.preauth.logout_noop";
export const OPS_PREAUTH_AGGREGATE = "platform.preauth.aggregate";
export const OPS_PREAUTH_EXHAUSTED = "platform.preauth.exhausted";

export type UnauthWriteOutcome = "written" | "aggregated" | "exhausted" | "suppressed";

/** The transaction surface this module needs; both a tx and a savepoint satisfy it. */
type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function countUnauthRowsIn(
  tx: AuditTx,
  windowStart: Date,
  ipAddress?: string,
): Promise<number> {
  const conditions = [
    // The marker KEY is a bound text parameter; it must not sit inside the
    // SQL quotes (that renders '->>''$1''' and binds nothing).
    sql`${platformAuditLog.detail}->>${OPS_PREAUTH_MARKER} = 'true'`,
    gte(platformAuditLog.createdAt, windowStart),
  ];
  if (ipAddress) conditions.push(eq(platformAuditLog.ipAddress, ipAddress));
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(platformAuditLog)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

async function countActionRowsIn(
  tx: AuditTx,
  action: string,
  windowStart: Date,
  ipAddress?: string,
): Promise<number> {
  const conditions = [
    eq(platformAuditLog.action, action),
    gte(platformAuditLog.createdAt, windowStart),
  ];
  if (ipAddress) conditions.push(eq(platformAuditLog.ipAddress, ipAddress));
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(platformAuditLog)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

async function writeUnauthEvent(
  tx: AuditTx,
  input: {
    action: string;
    detail?: Record<string, unknown>;
    ipAddress?: string;
    phase: string;
    outcome?: string;
  },
): Promise<UnauthWriteOutcome> {
  const windowStart = new Date(Date.now() - OPS_PREAUTH_WINDOW_MS);
  const global = await countUnauthRowsIn(tx, windowStart);
  if (global >= OPS_PREAUTH_GLOBAL_BUDGET) {
    // The window's budget is spent. ONE row per window records it and
    // NOTHING is written per request — the exhausted budget stops the
    // write, it does not merely stop the count.
    const alreadyExhausted = await countActionRowsIn(tx, OPS_PREAUTH_EXHAUSTED, windowStart);
    if (alreadyExhausted > 0) return "suppressed";
    await tx.insert(platformAuditLog).values({
      action: OPS_PREAUTH_EXHAUSTED,
      ipAddress: input.ipAddress,
      detail: {
        [OPS_PREAUTH_MARKER]: true,
        phase: input.phase,
        windowStartedAt: windowStart.toISOString(),
      },
      createdAt: new Date(),
    });
    return "exhausted";
  }
  if (input.ipAddress) {
    const perAddress = await countUnauthRowsIn(tx, windowStart, input.ipAddress);
    if (perAddress >= OPS_PREAUTH_ADDRESS_BUDGET) {
      // ONE aggregate row per address per window. The table cannot be
      // updated, so the row carries the FACT of the omission, not a
      // running count.
      const aggregates = await countActionRowsIn(
        tx,
        OPS_PREAUTH_AGGREGATE,
        windowStart,
        input.ipAddress,
      );
      if (aggregates > 0) return "aggregated";
      await tx.insert(platformAuditLog).values({
        action: OPS_PREAUTH_AGGREGATE,
        ipAddress: input.ipAddress,
        detail: {
          [OPS_PREAUTH_MARKER]: true,
          phase: input.phase,
          outcome: input.outcome ?? null,
          individualEventsSuppressed: true,
          windowStartedAt: windowStart.toISOString(),
        },
        createdAt: new Date(),
      });
      return "aggregated";
    }
  }
  await tx.insert(platformAuditLog).values({
    action: input.action,
    ipAddress: input.ipAddress,
    detail: { ...(input.detail ?? {}), [OPS_PREAUTH_MARKER]: true },
    createdAt: new Date(),
  });
  return "written";
}

/**
 * The ONE admission-lock boundary for every budget-owned insert. Lock, then
 * count/aggregate/insert; nothing else (no credential check, no network, no
 * caller work). This helper is the whole critical section.
 */
async function writeUnauthEventUnderAdmission(
  tx: AuditTx,
  input: Parameters<typeof writeUnauthEvent>[1],
): Promise<UnauthWriteOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${OPS_PREAUTH_ADMISSION_LOCK}))`);
  return writeUnauthEvent(tx, input);
}

/**
 * Writes an unauthenticated event in its OWN short transaction. The bounded
 * helper takes the admission lock immediately before the count/insert.
 *
 * A STORE FAILURE NEVER CHANGES THE CALLER'S OUTCOME (revision-4 review,
 * B3). If the row cannot be written, the loss is reported by the fixed,
 * safe alert and the caller carries on with its known outcome — the
 * refusal it was already going to make, the redirect it was already going
 * to send, the sign-out result it already has. No driver error escapes.
 */
export async function recordUnauthEvent(input: {
  action: string;
  detail?: Record<string, unknown>;
  ipAddress?: string;
  phase: string;
  outcome?: string;
  /** Alert-only pseudonymous hash; never added to the row. */
  identityHash?: string;
  correlationId: string;
}): Promise<UnauthWriteOutcome> {
  try {
    return await withPlatform(() =>
      db.transaction(async (tx) => writeUnauthEventUnderAdmission(tx, input)),
    );
  } catch {
    emitOpsAuthAuditAlert({
      phase: input.phase,
      outcome: input.outcome,
      identityHash: input.identityHash,
      correlationId: input.correlationId,
    });
    return "suppressed";
  }
}

/**
 * The same, inside a transaction the caller already owns. The helper
 * takes the admission lock immediately before the count/insert; the
 * caller's transaction holds only its account/address locks.
 *
 * A SAVEPOINT keeps the caller's own work alive when the store fails: the
 * unauth event rolls back on its own, the fixed alert records the loss,
 * and the caller's outcome — the credential failure it was already going
 * to report — is unchanged. Without the savepoint a failed insert would
 * abort the whole transaction and turn a refusal into an error.
 */
export async function recordUnauthEventInTx(
  tx: AuditTx,
  input: {
    action: string;
    detail?: Record<string, unknown>;
    ipAddress?: string;
    phase: string;
    outcome?: string;
    /** Alert-only pseudonymous hash; never added to the row. */
    identityHash?: string;
    correlationId: string;
  },
): Promise<UnauthWriteOutcome> {
  try {
    return await tx.transaction(async (savepoint) => writeUnauthEventUnderAdmission(savepoint, input));
  } catch {
    emitOpsAuthAuditAlert({
      phase: input.phase,
      outcome: input.outcome,
      identityHash: input.identityHash,
      correlationId: input.correlationId,
    });
    return "suppressed";
  }
}

