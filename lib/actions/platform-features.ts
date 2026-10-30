"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  updateFeatureInput,
  updateFeature,
  type UpdateFeatureResult,
} from "@/db/platform-features";
import {
  upsertTenantFeatureInput,
  upsertTenantFeature,
  type UpsertTenantFeatureResult,
} from "@/db/platform-tenant-features";

// Re-export for client islands that wire the action to useActionState.
export type { UpsertTenantFeatureResult };
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { recordOpsMutationTrace, recordOpsThrownFailure } from "@/lib/auth/ops-operation";
import { opsAction } from "@/db/ops-action";
import { asUserId } from "@/lib/ids";
import { isMandatoryModule } from "@/lib/feature-flags";

// Phase 1.7 + 1.8 — server actions for the platform surface.
//   1.7 — updateFeatureAction backs the feature catalogue editor.
//   1.8 — upsertTenantFeatureAction backs the per-tenant override
//   toggle on the tenant detail page.
//
// Both open with (1) zod-parse preamble, (2) platform-session
// permission check, then delegate to the service layer.
//
// H1 — both actions now take FormData so the corresponding forms
// use <form action={fn}> rather than onSubmit. Pre-hydration
// submits POST to the server action endpoint instead of falling
// through to a native GET that puts form fields in the URL.

// ---- 1.7 catalogue edit ----

const updateFormInputSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(["ga", "beta", "internal"]),
});

export type UpdateFeatureFormInput = z.input<typeof updateFormInputSchema>;

export async function updateFeatureAction(
  _prev: unknown,
  formData: FormData,
): Promise<UpdateFeatureResult> {
  // (1) parse
  const surface = updateFormInputSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    category: String(formData.get("category") ?? ""),
    status: String(formData.get("status") ?? ""),
  });
  if (!surface.success) {
    await recordOpsMutationTrace("feature.update", "invalid");
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const normalised: z.input<typeof updateFeatureInput> = {
    key: String(formData.get("key") ?? ""),
    ...surface.data,
  };

  // (2) platform session, fully past 2FA.
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("feature.update", "denied");
    return {
      kind: "error",
      code: "invalid",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }

  const result = await opsAction(
    {
      scope: "feature.update",
      actorId: asUserId(status.userId),
      targetType: "feature",
      detail: { key: normalised.key },
    },
    () => updateFeature(normalised, { actorId: asUserId(status.userId) }),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("feature.update", error);
    throw error;
  });
  if (result.kind === "ok") {
    revalidatePath("/ops/features");
  }
  if (result.kind !== "ok") {
    await recordOpsMutationTrace("feature.update", "error");
  }
  return result;
}

// ---- 1.8 per-tenant feature override ----

// tenantId arrives as a hidden form field; the server re-validates
// it so a tampered cookie replier can't move the toggle to a
// different tenant.
// Native submit controls carry their intent, including before hydration.
// Legacy callers must send an exact boolean literal for an override.
const upsertFormInputSchema = z.object({
  featureKey: z.string(),
  mode: z.enum(["enable", "disable", "clear", "override"]),
  enabled: z.string().optional(),
  expiresAt: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.mode === "override" && value.enabled !== "true" && value.enabled !== "false") {
    ctx.addIssue({ code: "custom", path: ["enabled"], message: 'The enabled field must be exactly "true" or "false".' });
  }
});

export type UpsertTenantFeatureFormInput = z.input<typeof upsertFormInputSchema>;

/**
 * The refusal a mandatory core module gets, whatever intent was asked
 * for.
 *
 * The shared result union lives in the service module (a protected
 * path), so the refusal reuses its "invalid" code and carries the
 * operator-facing explanation in the message — the console renders
 * that message on the row it just tried to change.
 */
function mandatoryModuleRefusal(featureKey: string): UpsertTenantFeatureResult {
  return {
    kind: "error",
    code: "invalid",
    message: `"${featureKey}" is a mandatory core module: it is always on for every tenant, so its per-tenant entitlement cannot be enabled, disabled, overridden or reset. The runtime ignores any stored override, and an existing row has been left untouched.`,
  };
}

// The trace name follows the submitted mode. Each branch calls the
// boundary with a LITERAL operation name: a computed name would be a name
// no coverage check can prove, and the registry
// (lib/auth/ops-operation.ts) is the contract for these operations.
//
// The parse-failure branch keeps the documented family default
// (tenant_feature.upsert), because a malformed request names no mode.
async function traceTenantFeature(
  outcome: "invalid" | "denied" | "error",
  mode: "override" | "clear",
  tenantId?: string,
): Promise<void> {
  if (mode === "clear") {
    await recordOpsMutationTrace("tenant_feature.clear", outcome, { tenantId });
    return;
  }
  await recordOpsMutationTrace("tenant_feature.upsert", outcome, { tenantId });
}

// The THROWN-failure twin of traceTenantFeature. The original error is
// rethrown by the caller; this only records how the call ended.
async function traceThrownTenantFeature(
  error: unknown,
  mode: "override" | "clear",
  tenantId?: string,
): Promise<void> {
  if (mode === "clear") {
    await recordOpsThrownFailure("tenant_feature.clear", error, { tenantId });
    return;
  }
  await recordOpsThrownFailure("tenant_feature.upsert", error, { tenantId });
}

export async function upsertTenantFeatureAction(
  _prev: unknown,
  formData: FormData,
): Promise<UpsertTenantFeatureResult> {
  // (1) parse
  const surface = upsertFormInputSchema.safeParse({
    featureKey: String(formData.get("featureKey") ?? ""),
    mode: String(formData.get("mode") ?? ""),
    enabled: formData.get("enabled") ?? undefined,
    expiresAt: formData.get("expiresAt")?.toString() || undefined,
  });
  if (!surface.success) {
    await recordOpsMutationTrace("tenant_feature.upsert", "invalid");
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const tenantId = String(formData.get("tenantId") ?? "");
  const serviceMode = surface.data.mode === "clear" ? "clear" : "override";
  const normalised: z.input<typeof upsertTenantFeatureInput> = {
    tenantId,
    featureKey: surface.data.featureKey,
    mode: serviceMode,
    enabled: surface.data.mode === "enable" ||
      (surface.data.mode === "override" && surface.data.enabled === "true"),
    expiresAt: surface.data.expiresAt || undefined,
  };

  // (2) platform session, fully past 2FA.
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await traceTenantFeature("denied", serviceMode, tenantId);
    return {
      kind: "error",
      code: "invalid",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }

  // (3) F05 — a mandatory core module cannot be forced on, forced off
  // or reset for a tenant. The role denial above still comes first, so
  // a viewer is told their account is read-only rather than that a
  // module is mandatory; this check only ever refuses a request an
  // admin made. The refusal happens before the service call, so
  // nothing is written and no success audit is recorded.
  //
  // The key is trimmed for the CHECK, exactly as the service trims it
  // before it stores it, so a padded key cannot slip past the policy.
  // A stored override for a core module is NOT deleted: the runtime
  // ignores it, and clearing it would be a data migration this action
  // has no business doing.
  if (isMandatoryModule(normalised.featureKey.trim())) {
    // The refusal is a refusal: it is recorded as a denied operation,
    // and the domain write never happens.
    await traceTenantFeature("denied", serviceMode, tenantId);
    return mandatoryModuleRefusal(normalised.featureKey.trim());
  }

  const result = await opsAction(
    {
      scope:
        serviceMode === "clear"
          ? "tenant_feature.clear"
          : "tenant_feature.upsert",
      actorId: asUserId(status.userId),
      tenantId,
      targetType: "tenant_feature",
      detail: { featureKey: normalised.featureKey },
    },
    () =>
      upsertTenantFeature(normalised, {
        actorId: asUserId(status.userId),
      }),
  ).catch(async (error: unknown) => {
    await traceThrownTenantFeature(error, serviceMode, tenantId);
    throw error;
  });
  if (result.kind === "ok") {
    revalidatePath(`/ops/tenants/${tenantId}`);
  }
  if (result.kind !== "ok") {
    await traceTenantFeature("error", serviceMode, tenantId);
  }
  return result;
}