import { eq, sql } from "drizzle-orm";
import {
  currentOpsActorId,
  currentOpsScope,
  currentOpsTenantId,
} from "./ops-action";
import { platformUsers } from "./schema/platform-users";
import type { TenantTx } from "./tenant";
import type { UserId } from "@/lib/ids";

/** The two audited scopes this lane's writes may run under. */
export type CommercialScope =
  | "tenant.plan.reassign"
  | "tenant.trial_deadline.set";

/**
 * True when the ambient operation is exactly this scope, actor and
 * tenant. The write is allowed only then.
 */
export function isAuditedAs(
  scope: CommercialScope,
  actorId: UserId,
  tenantId: string,
): boolean {
  return (
    currentOpsScope() === scope &&
    currentOpsActorId() === actorId &&
    currentOpsTenantId() === tenantId
  );
}

/**
 * The actor, re-read INSIDE the transaction.
 *
 * opsAction checks the role before the transaction opens; an account can
 * lose the admin role in between, and a write that lands after that is a
 * write nobody authorised.
 */
export async function actorIsActiveAdmin(
  tx: TenantTx,
  actorId: UserId,
): Promise<boolean> {
  const rows = await tx
    .select({ role: platformUsers.role, status: platformUsers.status })
    .from(platformUsers)
    .where(eq(platformUsers.id, actorId))
    .limit(1).for("share");
  const actor = rows[0];
  return actor?.role === "admin" && actor.status === "active";
}

/** The commercial facts of the tenant, read under the row lock. */
export type LockedTenant = {
  /** The plan the club is on now (null when it has none). */
  planId: string | null;
  planName: string | null;
  /** The recorded trial end date (null when there is none). */
  trialExpiresAt: Date | null;
  status: string;
};

/**
 * Lock the tenant row for the rest of the transaction and read its
 * commercial facts.
 *
 * The lock is taken on the tenant row only (`FOR UPDATE OF t`), so the
 * outer join to the plan does not lock the plan as well — the plan row
 * is locked separately, in share mode, by the plan write.
 */
export async function lockTenantForCommercialWrite(
  tx: TenantTx,
  tenantId: string,
): Promise<LockedTenant | null> {
  const rows = await tx.execute<{
    planId: string | null;
    planName: string | null;
    trialExpiresAt: Date | string | null;
    status: string;
  }>(sql`
    select t.plan_id               as "planId",
           p.name                   as "planName",
           t.trial_expires_at       as "trialExpiresAt",
           t.status                 as status
    from tenants t
    left join plans p on p.id = t.plan_id
    where t.id = ${tenantId}
    for update of t
  `);
  const row = (
    rows as unknown as {
      rows: Array<{
        planId: string | null;
        planName: string | null;
        trialExpiresAt: Date | string | null;
        status: string;
      }>;
    }
  ).rows[0];
  if (!row) return null;
  return {
    planId: row.planId,
    planName: row.planName,
    trialExpiresAt: row.trialExpiresAt === null
      ? null
      : new Date(row.trialExpiresAt),
    status: row.status,
  };
}

/** True when two optional instants are the same instant. */
export function sameInstant(
  left: Date | null,
  right: Date | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}
