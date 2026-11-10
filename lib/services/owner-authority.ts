import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { TenantTx } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import type { ActionCtx } from "@/lib/auth/context";
import { callerIsLiveOwnerInTx } from "@/lib/services/leave-owner-identity";

// Each new owner-only surface requires an explicit F-04/F-03a exception.
// The existing owner predicate locks the live membership and role; this
// additional membership-joined lock also fails closed for a deleted user.
export async function callerIsLiveOwnerForSettingsOrDelegation(
  tx: TenantTx,
  ctx: ActionCtx,
): Promise<boolean> {
  const userId = ctx.userId;
  if (!userId || !z.string().uuid().safeParse(userId).success || !(await callerIsLiveOwnerInTx(tx, ctx))) return false;
  const [row] = await tx.select({ id: users.id }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .where(and(eq(tenantMemberships.tenantId, ctx.tenantId),
      eq(tenantMemberships.userId, userId), isNull(users.deletedAt)))
    .limit(1).for("share", { of: users });
  return !!row;
}
