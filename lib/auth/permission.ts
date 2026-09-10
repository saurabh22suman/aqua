import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { rolePermissions, roles } from "@/db/schema/roles";
import type { Ctx } from "@/lib/auth/context";
import { PERMISSIONS } from "@/db/seed-platform";

// Tenant role gating — single permission resolution.
//
// The audit found authorization spread across:
//   - `assertStaff(ctx)` and three siblings, role-key lists that
//     admit every staff role (including coach) to every staff-gated
//     read.
//   - Feature entitlements (resolveTenantFeatureKeys()) that resolve
//     correctly but are never consulted at any callsite.
//   - Layouts that gate only on session existence.
//
// This module is the single resolution: `requirePermission(ctx,
// "members.read")` checks (1) the role carries that permission
// (via role_permissions), (2) the tenant's plan + overrides enable
// the module (via resolveTenantFeatureKeys), and (3) the call site
// is location-scoped (left to the per-action data fetch — a coarse
// tenant-scoped guard; the per-row scoping is RLS's job).
//
// Module derivation comes from PERMISSIONS in db/seed-platform.ts.
// The seed is the source of truth for "every permission's module"
// — see the invariant comment on PERMISSIONS there. We import the
// constant rather than reading it back from the DB because the
// AST scan (tests/tier1/permission-matrix.test.ts) needs to know
// the list at scan time, and the row state isn't available until
// after the seed runs.
const PERMISSION_TO_MODULE: Record<string, string> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p.module]),
);

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

// Resolve a single permission against both the role's grant set and
// the tenant's feature entitlement. Throws ForbiddenError — the
// action's catch is responsible for translating it into the right
// user-visible error. Today no action catches it; the test suite
// mutation proof (sub-PR 3) will catch a missing requirePermission
// at a callsite before the user does.
export function requirePermission(ctx: Ctx, permissionKey: string): void {
  if (!ctx.permissions.has(permissionKey)) {
    throw new ForbiddenError(permissionKey, "role_grant_missing");
  }
  const moduleKey = PERMISSION_TO_MODULE[permissionKey];
  // If the permission isn't in the closed PERMISSIONS list, this is
  // a developer error — fail closed with a clear message rather than
  // silently allowing.
  if (!moduleKey) {
    throw new ForbiddenError(permissionKey, "role_grant_missing");
  }
  if (ALWAYS_ON_MODULES.has(moduleKey)) return;
  if (!ctx.features.has(moduleKey)) {
    throw new ForbiddenError(permissionKey, "feature_disabled");
  }
}

// Resolve the role's permission set and the tenant's feature set
// inside one withTenant() so the ctx that flows downstream carries
// both. Called from lib/auth/context.ts's requireDefaultCtx and
// resolveCtxFor.
//
// The module field on PERMISSIONS is the canonical link to the
// features table — every permission's module is a features.key row
// (the seed enforces this; tests/tier1/platform-entitlements.test.ts
// pins it). We read the role_permissions rows for the membership's
// role, not all role_permissions rows, because the role is what
// gates the caller's permissions — not the tenant.
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
        .where(eq(roles.id, roleId))
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
