import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { withPlatformAdmin } from "./scope";
import { withTenant } from "./tenant";
import { tenants } from "./schema/tenants";
import { platformAuditLog } from "./schema/platform-users";
import { tenantFeatures } from "./schema/tenant-features";
import { features } from "./schema/platform";
import type { TenantId, UserId } from "@/lib/ids";

// Phase 1.8 — platform-side toggle for per-tenant feature
// overrides. Mirrors the 1.5 / 1.6 / 1.7 platform-write pattern:
// `withPlatformAdmin()` opens a transaction, sets
// `app.platform_admin = 'true'`, and is the only scope that can
// pass the RLS policies (`tenant_isolation` denies cross-tenant
// writes; `platform_admin_all` on tenant_features allows them).
//
// Per architecture §7.1, resolution = plan overridden by tenant.
// The toggle here is the per-tenant override:
//   - `enabled=true`  : force this feature on, regardless of plan.
//   - `enabled=false` : force this feature off, regardless of plan.
//   - `expires_at`    : null = permanent, or a future timestamp = trial.
//
// The semantics of "set the override to the same state the plan
// already says" are an explicit delete: a tenant row that's
// override-equivalent to the plan is a no-op row that the resolver
// still has to walk. Removing it is cheaper. The action surfaces
// that decision as `mode: "override" | "clear"`:
//
//   mode="override" → upsert a row with (enabled, expiresAt?)
//   mode="clear"    → delete the row, fall back to the plan
//
// That decision belongs to the form (which knows the toggle's
// previous state), not to this service. We accept both modes so
// the same Server Action signature covers both flows.

export const upsertTenantFeatureInput = z.object({
  tenantId: z.string().uuid(),
  featureKey: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(
      /^[a-z0-9](?:[a-z0-9._-]{0,58}[a-z0-9])$/,
      "Feature key must be lowercase letters, numbers, dots, hyphens, or underscores.",
    ),
  mode: z.enum(["override", "clear"]),
  enabled: z.boolean(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .nullable()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Closed enum — the feature table's status column already
  // restricts, but parsing at the boundary gives us a typed error
  // path instead of a Postgres check violation on save.
  // Not used today (config is out of scope for this phase) but the
  // shape is here so future per-feature config doesn't require a
  // schema change.
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpsertTenantFeatureInput = z.input<typeof upsertTenantFeatureInput>;

export type UpsertTenantFeatureResult =
  | {
      kind: "ok";
      tenantId: TenantId;
      featureKey: string;
      mode: "override" | "clear";
    }
  | {
      kind: "error";
      code:
        | "invalid"
        | "tenant_not_found"
        | "feature_not_found"
        | "internal";
      message: string;
    };

export async function upsertTenantFeature(
  rawInput: UpsertTenantFeatureInput,
  ctx: { actorId: UserId },
): Promise<UpsertTenantFeatureResult> {
  const parsed = upsertTenantFeatureInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  // Validate the feature key exists at the platform scope. Without
  // this, a typo in the form would silently create a tenant_features
  // row referencing a feature_key with no entry in `features` —
  // invisible in the catalogue, dangling on every audit timeline.
  const tenantId = input.tenantId as TenantId;
  return withPlatformAdmin(async (tx) => {
    const featureRows = await tx
      .select({ key: features.key })
      .from(features)
      .where(eq(features.key, input.featureKey))
      .limit(1);
    if (featureRows.length === 0) {
      return {
        kind: "error",
        code: "feature_not_found",
        message: `Unknown feature key "${input.featureKey}".`,
      } satisfies UpsertTenantFeatureResult;
    }

    // Validate the tenant exists. The RLS layer already denies
    // writes to unknown tenants cleanly (the row update matches
    // zero rows), but the structured error code we hand back is
    // more useful when "tenant_not_found" is explicit. Plus a
    // missing tenant is almost always a stale URL — surface it.
    //
    // Note: under withPlatformAdmin, tenants is read-write for the
    // operator; the SELECT here also surfaces any tenant's existence
    // (the existing platform_admin_select policy). The withTenant
    // path would be a tighter alternative but it scopes the write
    // to a single app.tenant_id; the platform_admin path is required
    // because tenant_id is operator-supplied here.
    const tenantRows = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (tenantRows.length === 0) {
      return {
        kind: "error",
        code: "tenant_not_found",
        message: `No tenant with id "${input.tenantId}".`,
      } satisfies UpsertTenantFeatureResult;
    }

    if (input.mode === "clear") {
      // Delete the override row — fall back to plan baseline.
      const deleted = await tx
        .delete(tenantFeatures)
        .where(
          and(
            eq(tenantFeatures.tenantId, tenantId),
            eq(tenantFeatures.featureKey, input.featureKey),
          ),
        )
        .returning({ featureKey: tenantFeatures.featureKey });

      if (deleted.length > 0) {
        await tx.insert(platformAuditLog).values({
          actorId: ctx.actorId,
          tenantId,
          action: "tenant_feature.clear",
          targetType: "tenant_feature",
          targetId: null,
          detail: { featureKey: input.featureKey },
        });
      }
      // No-op clear (no row to delete) returns ok with mode recorded;
      // a duplicate click by the operator isn't an error.
    } else {
      // Override: upsert the row. The (tenantId, featureKey) PK
      // guarantees no duplicate keys at this layer; ON CONFLICT
      // updates the row in place. All optional fields are passed
      // explicitly (as `null` rather than omitted) so the
      // parameter list is shape-stable — drizzle's ON CONFLICT
      // DO UPDATE parameter binding is easier to reason about when
      // every column position is sent on every call.
      await tx
        .insert(tenantFeatures)
        .values({
          tenantId,
          featureKey: input.featureKey,
          enabled: input.enabled,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          config: input.config ?? {},
        })
        .onConflictDoUpdate({
          target: [tenantFeatures.tenantId, tenantFeatures.featureKey],
          set: {
            enabled: input.enabled,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            config: input.config ?? {},
            updatedAt: new Date(),
          },
        });

      await tx.insert(platformAuditLog).values({
        actorId: ctx.actorId,
        tenantId,
        action: "tenant_feature.upsert",
        targetType: "tenant_feature",
        targetId: null,
        detail: {
          featureKey: input.featureKey,
          enabled: input.enabled,
          ...(input.expiresAt
            ? { expiresAt: new Date(input.expiresAt).toISOString() }
            : {}),
          ...(input.config ? { config: input.config } : {}),
        },
      });
    }

    return {
      kind: "ok",
      tenantId,
      featureKey: input.featureKey,
      mode: input.mode,
    } satisfies UpsertTenantFeatureResult;
  });
}

// Phase 1.8 — count of overrides per feature, used by the
// tenant-detail "Feature state" page to surface "X tenants have
// overridden this baseline". Bounded by the platform_admin_select
// policy on the underlying tables.
export async function getAllOverriddenFeaturesForTenant(
  tenantId: TenantId,
): Promise<
  Array<{
    featureKey: string;
    enabled: boolean;
    expiresAt: Date | null;
    updatedAt: Date;
  }>
> {
  return withPlatformAdmin(async (tx) => {
    const rows = await tx
      .select({
        featureKey: tenantFeatures.featureKey,
        enabled: tenantFeatures.enabled,
        expiresAt: tenantFeatures.expiresAt,
        updatedAt: tenantFeatures.updatedAt,
      })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.tenantId, tenantId));
    return rows;
  });
}

// Unused helper kept loose; the withTenant variant lets a tenant
// user read their own overrides, which today is unused (the
// Ctx.featureKeys path lives in resolveTenantFeatureKeys, not here)
// but provides a clean API if the codebase later wants to expose
// per-tenant override metadata to the tenant surface.
void withTenant;
