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
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

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
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  const result = await updateFeature(normalised, { actorId: asUserId(status.userId) });
  if (result.kind === "ok") {
    revalidatePath("/platform/features");
  }
  return result;
}

// ---- 1.8 per-tenant feature override ----

// tenantId arrives as a hidden form field; the server re-validates
// it so a tampered cookie replier can't move the toggle to a
// different tenant.
const upsertFormInputSchema = z.object({
  featureKey: z.string(),
  mode: z.enum(["override", "clear"]),
  enabled: z.boolean(),
  expiresAt: z.string().optional(),
});

export type UpsertTenantFeatureFormInput = z.input<typeof upsertFormInputSchema>;

export async function upsertTenantFeatureAction(
  _prev: unknown,
  formData: FormData,
): Promise<UpsertTenantFeatureResult> {
  // (1) parse
  const surface = upsertFormInputSchema.safeParse({
    featureKey: String(formData.get("featureKey") ?? ""),
    mode: String(formData.get("mode") ?? ""),
    enabled: formData.get("enabled") === "true",
    expiresAt: formData.get("expiresAt")?.toString() || undefined,
  });
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const tenantId = String(formData.get("tenantId") ?? "");
  const normalised: z.input<typeof upsertTenantFeatureInput> = {
    tenantId,
    ...surface.data,
    expiresAt: surface.data.expiresAt || undefined,
  };

  // (2) platform session, fully past 2FA.
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  const result = await upsertTenantFeature(normalised, {
    actorId: asUserId(status.userId),
  });
  if (result.kind === "ok") {
    revalidatePath(`/platform/tenants/${tenantId}`);
  }
  return result;
}