import { and, eq, inArray, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { withPlatform } from "@/db/scope";
import { withTenant, type TenantTx } from "@/db/tenant";
import { OPERATIONAL_TENANT_STATUSES, platformUserId } from "@/db/platform";
import { tenants } from "@/db/schema/tenants";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { auth } from "@/lib/auth/server";
import { isSessionExpiredForRole } from "@/lib/auth/permissions";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { asTenantId } from "@/lib/ids";

export type BrandingSource = "staff" | "member" | "guardian";

/** The requested UUID is a selector only; authorization and read share a transaction. */
export async function readAuthorizedBrandingTarget<T>(
  tenantId: string, source: BrandingSource, read: (tx: TenantTx) => Promise<T>,
): Promise<T | null> {
  if (!z.string().uuid().safeParse(tenantId).success || !["staff", "member", "guardian"].includes(source)) return null;
  try {
    if (source !== "staff") {
      const resolver = await resolveSelfScope(source, null);
      if (!resolver || resolver.scope.tenantId !== tenantId) return null;
      return await resolver.read(async (tx, scope) => scope.tenantId === tenantId ? read(tx) : null);
    }
    const h = await headers();
    const session = await withPlatform(() => auth.api.getSession({ headers: h }));
    if (!session?.user || !session.session) return null;
    const createdAt = new Date(session.session.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return null;
    const userId = await platformUserId(session.user.id);
    if (!userId) return null;
    return await withTenant(tenantId, async (tx) => {
      const [row] = await tx.select({ roleKey: roles.key }).from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId))
        .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
        .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)))
        .where(and(eq(tenantMemberships.tenantId, asTenantId(tenantId)), eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt),
          isNull(users.deletedAt), isNull(roles.deletedAt), inArray(tenants.status, [...OPERATIONAL_TENANT_STATUSES])))
        .limit(1).for("share");
      if (!row || isSessionExpiredForRole(row.roleKey, createdAt)) return null;
      return read(tx);
    });
  } catch {
    return null;
  }
}
