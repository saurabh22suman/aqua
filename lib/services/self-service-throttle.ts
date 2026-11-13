// POSTIMAGE — lib/services/self-service-throttle.ts  (candidate, NOT applied)
//
// THE PER-ACCOUNT ATTEMPT BUDGET BEHIND THE SELF PIN DOOR.
//
// WHY IT EXISTS
//   better-auth's per-IP rate limiter (lib/auth/server.ts) is applied to
//   better-auth's OWN HTTP endpoints. The self door calls the password
//   verifier directly and never enters that path, so the per-IP layer the
//   staff door is credited with is NOT in front of it. Without an attempt
//   budget, a caller can spray many attempts at one account.
//
// THE SHAPE IS THE REPOSITORY'S OWN: an advisory lock keyed on the
// budget, the count and the write in ONE transaction, so the budget cannot
// race.
//
// THE BUDGET IS TENANT-BOUND AND ACCOUNT-BOUND
//   The unique index is (tenant_id, user_id): the account IS the budget
//   key (`users.phone` is globally unique), and the address is a MIRRORED
//   column rather than a key. An address-keyed budget would admit a
//   second row for the same account spelled a second way, which is the
//   bypass the E.164 CHECK was meant to close and does not.
//
// THE TENANT MUST BE KNOWN BEFORE THE BUDGET CAN BE SPENT
//   The row's tenant_id is NOT NULL, so there is no budget without a
//   club. The door therefore resolves account -> live link -> club BEFORE
//   it compares a PIN, and refuses before it compares. That ordering is a
//   security property, not a style choice.
//
// THE COUNTER COUNTS EVERY ATTEMPT, including successful ones. The API
// contract says "20 attempts per 15 minutes", not "20 failures", so the
// contract and the implementation agree. The cost is that twenty sign-ins
// in fifteen minutes exhaust the budget — a nuisance, never an account
// lock-out. The per-ACCOUNT lockout is the staff door's
// (lib/services/pin-lockout.ts) and it is unchanged.

import { and, eq, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { selfServiceLoginAttempts } from "@/db/schema/self-service-session";
import type { TenantId, UserId } from "@/lib/ids";

export const SELF_SERVICE_ATTEMPT_WINDOW_MS = 15 * 60_000;
export const SELF_SERVICE_ATTEMPT_LIMIT = 20;

/**
 * Spends one attempt from the account's budget for this club.
 *
 * Returns false when the budget is exhausted, and true otherwise — the
 * caller maps both to the same generic failure.
 */
export async function consumeSelfServiceBudgetInTx(
  tx: TenantTx,
  args: { tenantId: TenantId; userId: UserId; address: string },
): Promise<boolean> {
  // The advisory lock is keyed on the BUDGET, not on the address: the
  // budget is per (club, account).
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`self-service-budget:${args.tenantId}:${args.userId}`}))`,
  );

  const now = Date.now();
  const rows = await tx
    .select({
      id: selfServiceLoginAttempts.id,
      windowStartedAt: selfServiceLoginAttempts.windowStartedAt,
      attempts: selfServiceLoginAttempts.attempts,
    })
    .from(selfServiceLoginAttempts)
    .where(
      and(
        eq(selfServiceLoginAttempts.tenantId, args.tenantId),
        eq(selfServiceLoginAttempts.userId, args.userId),
      ),
    )
    .limit(1);
  const row = rows[0];

  if (!row) {
    await tx.insert(selfServiceLoginAttempts).values({
      tenantId: args.tenantId,
      userId: args.userId,
      address: args.address,
      windowStartedAt: new Date(now),
      attempts: 1,
    });
    return true;
  }

  const windowExpired =
    now - row.windowStartedAt.getTime() > SELF_SERVICE_ATTEMPT_WINDOW_MS;
  if (windowExpired) {
    await tx
      .update(selfServiceLoginAttempts)
      .set({ windowStartedAt: new Date(now), attempts: 1, address: args.address })
      .where(eq(selfServiceLoginAttempts.id, row.id));
    return true;
  }

  if (row.attempts >= SELF_SERVICE_ATTEMPT_LIMIT) return false;

  await tx
    .update(selfServiceLoginAttempts)
    .set({ attempts: row.attempts + 1, address: args.address })
    .where(eq(selfServiceLoginAttempts.id, row.id));
  return true;
}
