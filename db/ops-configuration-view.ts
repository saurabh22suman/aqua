import { and, asc, eq, isNull } from "drizzle-orm";
import { withTenant } from "./tenant";
import { roles, rolePermissions } from "./schema/roles";
import { resolveAllConfig, type ResolvedConfig } from "./config";
import { getTenantDetail, type TenantDetail } from "./platform-tenants";
import type { TenantId } from "@/lib/ids";

// O-06 (docs/ops-platform-design.md §6) — the effective-configuration
// viewer's data. For one tenant: every resolved config value with
// provenance, the entitlement set with its source, the role/permission
// matrix and the nav each role renders.
//
// PII-free by construction: this module reads tenant metadata
// (getTenantDetail aggregates only), the config registry, and
// roles/permissions. It never touches persons, members, guardianships
// or attendance. tests/ops-configuration-view.test.ts pins that with a
// source scan.

export type RoleMatrixRow = {
  key: string;
  name: string;
  homePath: string;
  homeOrdinal: number;
  permissions: string[];
};

export type LocationConfiguration = {
  locationId: string;
  locationName: string;
  isPrimary: boolean;
  values: ResolvedConfig[];
};

export type EffectiveConfiguration = {
  tenant: TenantDetail;
  // Resolved at tenant scope (owning preset).
  config: ResolvedConfig[];
  // Resolved per location (location binding wins where set).
  locationConfig: LocationConfiguration[];
  roles: RoleMatrixRow[];
};

export async function getEffectiveConfiguration(
  tenantId: TenantId,
): Promise<EffectiveConfiguration | null> {
  const tenant = await getTenantDetail(tenantId);
  if (!tenant) return null;

  const config = await resolveAllConfig(tenantId);

  const locationConfig: LocationConfiguration[] = [];
  for (const location of tenant.locations) {
    locationConfig.push({
      locationId: location.id,
      locationName: location.name,
      isPrimary: location.isPrimary,
      values: await resolveAllConfig(tenantId, { locationId: location.id }),
    });
  }

  const roleRows = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: roles.id,
        key: roles.key,
        name: roles.name,
        homePath: roles.homePath,
        homeOrdinal: roles.homeOrdinal,
      })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
      .orderBy(asc(roles.homeOrdinal), asc(roles.key));

    const grants = await tx
      .select({
        roleId: rolePermissions.roleId,
        permissionKey: rolePermissions.permissionKey,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.tenantId, tenantId))
      .orderBy(asc(rolePermissions.permissionKey));

    const byRole = new Map<string, string[]>();
    for (const grant of grants) {
      const list = byRole.get(grant.roleId) ?? [];
      list.push(grant.permissionKey);
      byRole.set(grant.roleId, list);
    }

    return rows.map((row) => ({
      key: row.key,
      name: row.name,
      homePath: row.homePath,
      homeOrdinal: row.homeOrdinal,
      permissions: byRole.get(row.id) ?? [],
    }));
  });

  return { tenant, config, locationConfig, roles: roleRows };
}
