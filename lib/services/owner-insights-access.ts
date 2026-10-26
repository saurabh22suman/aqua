import { withTenant, type TenantTx } from "@/db/tenant";
import { resolveTenantFeatureKeys } from "@/db/features";
import { ForbiddenError } from "@/lib/auth/permission";
import { callerHasPermission } from "@/lib/services/resource-access";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import type { ActionCtx } from "@/lib/auth/context";

// The gate in front of both owner-insight read models.
//
// Three checks, in this order, all before any data is read:
//
//   1. IDENTITY — a permission set on its own is not a caller. A
//      context without a user and without a role claim is refused,
//      because "the ctx says the permission is present" is a
//      statement, not a person.
//
//   2. FEATURE — the tenant's entitlement for the `reports` module.
//      The operator's Reports switch is a real control (the audit's
//      "operator turning Reports off" case), and a page that imports a
//      service directly bypasses the action layer where that check
//      normally lives. So the check happens HERE too.
//
//   3. ROLE GRANT — the caller's role must carry the same permission
//      the existing operational reports ride, so the chart and the
//      report it summarises answer to one grant.
//
// The Service Action, when it is wired (it needs the shared
// action-permission map, which this lane does not own), must STILL run
// requirePermission(ctx, OWNER_INSIGHT_PERMISSION_KEY): the action
// layer stays the authorization boundary, this is defence in depth for
// the direct-import path.

export const OWNER_INSIGHT_PERMISSION_KEY = "reports.operational";
export const OWNER_INSIGHT_FEATURE_KEY = "reports";

export type InsightScope = {
  /** The tenant's timezone — the read models' calendar days are its days. */
  timezone: string;
};

// Identity + feature entitlement. Opens its own transaction for the
// feature read (db/features.ts resolves plan + per-tenant overrides
// and cannot nest inside another tenant scope).
export async function assertInsightAccess(ctx: ActionCtx): Promise<void> {
  if (!ctx.userId && !ctx.roleKey) {
    throw new ForbiddenError(OWNER_INSIGHT_PERMISSION_KEY, "role_grant_missing");
  }
  const features = await resolveTenantFeatureKeys(ctx.tenantId);
  if (!features.includes(OWNER_INSIGHT_FEATURE_KEY)) {
    throw new ForbiddenError(OWNER_INSIGHT_PERMISSION_KEY, "feature_disabled");
  }
}

// Identity + role grant, resolved inside the caller's own tenant
// scope. Every read path goes through this — including the internal
// data-access module, so there is no way to reach the rows without a
// grant.
export async function assertInsightGrant(tx: TenantTx, ctx: ActionCtx): Promise<void> {
  if (!ctx.userId && !ctx.roleKey) {
    throw new ForbiddenError(OWNER_INSIGHT_PERMISSION_KEY, "role_grant_missing");
  }
  if (!(await callerHasPermission(tx, ctx, OWNER_INSIGHT_PERMISSION_KEY))) {
    throw new ForbiddenError(OWNER_INSIGHT_PERMISSION_KEY, "role_grant_missing");
  }
}

// Identity, feature and grant together, plus the tenant timezone —
// for the read models that cannot fold the grant into their own
// transaction.
export async function insightScope(ctx: ActionCtx): Promise<InsightScope> {
  await assertInsightAccess(ctx);
  return withTenant(ctx.tenantId, async (tx) => {
    await assertInsightGrant(tx, ctx);
    return { timezone: await tenantTimezoneInTx(tx, ctx.tenantId) };
  });
}
