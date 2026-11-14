import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { rolePermissions, roles } from "@/db/schema/roles";
import type { Ctx } from "@/lib/auth/context";
import { PERMISSIONS } from "@/db/seed-platform";
import { hasBookingEntitlement } from "./booking-entitlement";

const PERMISSION_TO_MODULE: Record<string, string> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p.module]),
);

export function moduleForPermission(permissionKey: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(PERMISSION_TO_MODULE, permissionKey)
    ? PERMISSION_TO_MODULE[permissionKey]
    : undefined;
}

// Permissions whose module is "core" — every tenant has these
// modules in its plan baseline by construction (the standard plan
// grants every GA feature, and "members"/"attendance"/"programs"/
// "enquiries"/"staff"/"settings" are all GA per
// db/seed-platform.ts FEATURES). Rather than re-resolve the feature
// list for these on every call, we treat them as always-on for the
// module check. The role-grant check is still enforced.
const ALWAYS_ON_MODULES = new Set(["members", "attendance", "programs", "enquiries", "staff", "settings"]);

export class ForbiddenError extends Error {
  readonly permissionKey: string;
  readonly reason: "role_grant_missing" | "feature_disabled";
  constructor(permissionKey: string, reason: "role_grant_missing" | "feature_disabled") {
    super(`forbidden: ${reason} for permission '${permissionKey}'`);
    this.name = "ForbiddenError";
    this.permissionKey = permissionKey;
    this.reason = reason;
  }
}

// Cheap, allocation-free read against the in-request ctx. Used by
// UI gates and the layout, both of which want "is this allowed?"
// not "throw on no".
export function hasPermission(ctx: Ctx, permissionKey: string): boolean {
  return ctx.permissions.has(permissionKey);
}

// Cheap read against the in-request ctx for feature entitlements.
// Architecture §7.3 says both layers — the action layer calls
// requirePermission, the UI layer calls hasFeature / hasPermission
// and renders nothing when both come back false.
export function hasFeature(ctx: Ctx, module: string): boolean {
  return ctx.features.has(module);
}

export function requirePermission<T extends Pick<Ctx, "permissions" | "features">>(
  ctx: T,
  permissionKey: string,
): void {
  if (!ctx.permissions.has(permissionKey)) {
    throw new ForbiddenError(permissionKey, "role_grant_missing");
  }
  const moduleKey = moduleForPermission(permissionKey);
  // If the permission isn't in the closed PERMISSIONS list, this is
  // a developer error — fail closed with a clear message rather than
  // silently allowing.
  if (!moduleKey) {
    throw new ForbiddenError(permissionKey, "role_grant_missing");
  }
  if (ALWAYS_ON_MODULES.has(moduleKey)) return;
  if ((permissionKey === "bookings.read" || permissionKey === "bookings.write") && hasBookingEntitlement(ctx.features)) return;
  if (!ctx.features.has(moduleKey)) {
    throw new ForbiddenError(permissionKey, "feature_disabled");
  }
}

export async function resolvePermissionContext(
  tenantId: Ctx["tenantId"],
  roleId: Ctx["roleId"],
): Promise<{ permissions: Set<string>; features: Set<string> }> {
  const { permissionKeys } = await withTenant(tenantId, async (tx) => {
    const [permRows, roleRow] = await Promise.all([
      tx
        .select({ key: rolePermissions.permissionKey })
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId)),
      tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
        .limit(1),
    ]);
    if (roleRow.length === 0) {
      // A membership whose role row vanished is a bad state — fail
      // closed by returning no permissions. The caller is
      // requireDefaultCtx; throwing here would surface as a 500
      // instead of a clean redirect. Empty grants → user sees
      // nothing; the next page-render's layout will 404 on the
      // surface gate.
      return { permissionKeys: [] as string[] };
    }
    return { permissionKeys: permRows.map((r) => r.key) };
  });
  // Lazy import: db/features.ts imports from ./tenant; both are
  // usable from here, but TS/ESM module init order makes a direct
  // import look like a cycle in some toolchains. The runtime cost
  // is one CJS module lookup per request, negligible vs the SQL
  // round trip that already happened above.
  const { resolveTenantFeatureKeys } = await import("@/db/features");
  const enabled = await resolveTenantFeatureKeys(tenantId);
  const enabledSet = new Set(enabled);
  // ALSO add the always-on modules so hasFeature on a server action
  // that calls requirePermission("attendance.mark") doesn't depend
  // on the seed having enrolled that tenant in the attendance
  // feature. The audit's "operator turning Reports off" case is
  // unaffected: reports is NOT in ALWAYS_ON_MODULES.
  for (const m of ALWAYS_ON_MODULES) enabledSet.add(m);
  return {
    permissions: new Set(permissionKeys),
    features: enabledSet,
  };
}
