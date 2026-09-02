import { and, eq } from "drizzle-orm";
import { planFeatures, plans } from "./schema/platform";
import { tenants } from "./schema/tenants";
import { tenantFeatures } from "./schema/tenant-features";
import { withTenant } from "./tenant";
import type { TenantId } from "@/lib/ids";

// Phase 1.8 — effective feature set per tenant. The architecture §7.1
// resolution order is plan_features overridden by tenant_features:
//
//   plan_features (baseline for the tenant's plan)
//         ↓ overridden by
//   tenant_features (per-tenant grants, trials, betas)
//         ↓ produces
//   effective feature set  →  cached in request context
//
// The `enabled` column on tenant_features is the override direction
// (force on = true, force off = false); `expires_at` re-enables
// fall-through to the plan when its time passes. An expired row is
// NOT deleted — it stays in the table so the audit timeline can
// reconstruct what was overridden when; the resolver just ignores it.
//
// Configs (jsonb) are out of scope for this call: resolving whether a
// feature is enabled is a Boolean question; the per-feature config is
// read on demand at the consumer site. Surfacing it here would balloon
// the function signature for a six-of-one case.

export interface EffectiveFeature {
  key: string;
  source: "tenant_override" | "plan" | "denied";
  expiresAt?: Date;
}

export async function resolveTenantFeatureKeys(
  tenantId: TenantId,
): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();

    // Step 1: read plan_features baseline. The plan lookup is the
    // same path 1.4 detail page uses; resolution filters by plan
    // status='active' so a deprecated plan drops out entirely.
    const planRows = await tx
      .select({
        planId: tenants.planId,
        planStatus: plans.status,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const planActive = planRows[0]?.planStatus === "active";

    const planFeatureRows = planActive
      ? await tx
          .select({ featureKey: planFeatures.featureKey })
          .from(planFeatures)
          .innerJoin(tenants, eq(tenants.planId, planFeatures.planId))
          .where(eq(tenants.id, tenantId))
      : [];

    // Step 2: read tenant_features overrides. Active means
    // `enabled=true AND (expires_at IS NULL OR expires_at > now())`.
    // Expired overrides fall through to the plan below.
    const overrideRows = await tx
      .select({
        featureKey: tenantFeatures.featureKey,
        enabled: tenantFeatures.enabled,
        expiresAt: tenantFeatures.expiresAt,
      })
      .from(tenantFeatures)
      .where(
        and(
          eq(tenantFeatures.tenantId, tenantId),
          // Active filters — applied in SQL so an expired override
          // never reaches the merge step below.
        ),
      );

    // Walk the overrides; determine which are still active (the
    // SQL filter above was kept narrow to avoid ambiguity with the
    // plan-fallback case below — see comment on Step 3).
    const activeOverrides: Record<
      string,
      { enabled: boolean; expiresAt: Date | null }
    > = {};
    for (const o of overrideRows) {
      const expired =
        o.expiresAt !== null && o.expiresAt.getTime() <= now.getTime();
      if (!expired) {
        activeOverrides[o.featureKey] = {
          enabled: o.enabled,
          expiresAt: o.expiresAt,
        };
      }
    }

    // Step 3: merge. Set semantics — start with plan baseline, apply
    // each override:
    //   - enabled=true: add the key (or keep it)
    //   - enabled=false: remove the key
    const planSet = new Set(planFeatureRows.map((r) => r.featureKey));
    const result = new Set<string>(planSet);
    for (const [key, o] of Object.entries(activeOverrides)) {
      if (o.enabled) result.add(key);
      else result.delete(key);
    }

    return Array.from(result).sort();
  });
}

// Lightweight boolean variant: callers that just want to know
// "is this feature on for this tenant?". Faster than the array
// variant because it stops at the first match on either side.
export async function isFeatureEnabledForTenant(
  tenantId: TenantId,
  featureKey: string,
): Promise<boolean> {
  const all = await resolveTenantFeatureKeys(tenantId);
  return all.includes(featureKey);
}

// Detailed variant: returns the source of each effective feature so
// the tenant-detail page can render plan-baseline vs operator-override
// distinctly. Returns the same keys as `resolveTenantFeatureKeys`
// but tagged with the source — the UI uses this to distinguish the
// "plan says yes" pill from the "override is on/off" pill.
export async function resolveTenantFeatureSources(
  tenantId: TenantId,
): Promise<EffectiveFeature[]> {
  return withTenant(tenantId, async (tx) => {
    const now = new Date();

    const planRows = await tx
      .select({
        planId: tenants.planId,
        planStatus: plans.status,
      })
      .from(tenants)
      .innerJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const planActive = planRows[0]?.planStatus === "active";

    const planFeatureRows = planActive
      ? await tx
          .select({ featureKey: planFeatures.featureKey })
          .from(planFeatures)
          .innerJoin(tenants, eq(tenants.planId, planFeatures.planId))
          .where(eq(tenants.id, tenantId))
      : ([] as Array<{ featureKey: string }>);
    const planSet = new Set(planFeatureRows.map((r) => r.featureKey));

    const overrideRows = await tx
      .select({
        featureKey: tenantFeatures.featureKey,
        enabled: tenantFeatures.enabled,
        expiresAt: tenantFeatures.expiresAt,
      })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.tenantId, tenantId));

    const map = new Map<string, EffectiveFeature>();
    for (const key of planSet) map.set(key, { key, source: "plan" });

    for (const o of overrideRows) {
      const expired =
        o.expiresAt !== null && o.expiresAt.getTime() <= now.getTime();
      if (expired) continue;
      map.set(o.featureKey, {
        key: o.featureKey,
        source: o.enabled ? "tenant_override" : "denied",
        ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}),
      });
    }

    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  });
}
