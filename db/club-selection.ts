import { and,eq,inArray,isNull } from "drizzle-orm";
import { withUser } from "./tenant";
import { tenants } from "./schema/tenants";
import { tenantMemberships } from "./schema/memberships";
import { roles } from "./schema/roles";
import { platformUserId,OPERATIONAL_TENANT_STATUSES } from "./platform";
import { isSessionExpiredForRole } from "@/lib/auth/permissions";
import { isServedBySurface } from "@/lib/surface-paths";

export async function listClubChoices(betterAuthUserId: string, sessionCreatedAt: Date) {
  const userId = await platformUserId(betterAuthUserId);
  if (!userId) return [];
  return withUser(userId, async tx => {
    const rows = await tx.select({ tenantId: tenants.id, name: tenants.name,
      roleName: roles.name, roleKey: roles.key, homePath: roles.homePath })
      .from(tenantMemberships)
      .innerJoin(tenants,eq(tenants.id,tenantMemberships.tenantId))
      .innerJoin(roles,and(eq(roles.id,tenantMemberships.roleId),eq(roles.tenantId,tenants.id),isNull(roles.deletedAt)))
      .where(and(eq(tenantMemberships.userId,userId),eq(tenantMemberships.status,"active"),
        isNull(tenantMemberships.deletedAt),inArray(tenants.status,[...OPERATIONAL_TENANT_STATUSES])))
      .orderBy(tenants.name);
    return rows.filter(row => !isSessionExpiredForRole(row.roleKey,sessionCreatedAt.getTime()) &&
      row.homePath.startsWith("/") && !row.homePath.startsWith("//") &&
      !row.homePath.includes("\\") && isServedBySurface(row.homePath,"apex") &&
      row.homePath !== "/clubs" && row.homePath !== "/login" && row.homePath !== "/");
  });
}
