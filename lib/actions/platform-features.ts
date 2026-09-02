"use server";

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
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 1.7 + 1.8 — server actions for the platform surface.
//
// 1.7 — updateFeatureAction backs the feature catalogue editor.
// 1.8 — upsertTenantFeatureAction backs the per-tenant override
// toggle on the tenant detail page.
//
// Both open with (1) zod-parse preamble, (2) platform-session
// permission check, then delegate to the service layer.

// ---- 1.7 catalogue edit ----

const updateFormInputSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(["ga", "beta", "internal"]),
});

export type UpdateFeatureFormInput = z.input<typeof updateFormInputSchema>;

export async function updateFeatureAction(
  featureKey: string,
  input: unknown,
): Promise<UpdateFeatureResult> {
  // (1) parse
  const surface = updateFormInputSchema.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const normalised: z.input<typeof updateFeatureInput> = {
    key: featureKey,
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

  return updateFeature(normalised, { actorId: asUserId(status.userId) });
}

// ---- 1.8 per-tenant feature override ----

// Surface schema for the tenant-detail toggle form. tenantId
// arrives from the route param (not the form body) so a tampered
// cookie replier can't move the toggle to a different tenant —
// the Server Action signature takes the tenantId first.
const upsertFormInputSchema = z.object({
  featureKey: z.string(),
  mode: z.enum(["override", "clear"]),
  enabled: z.boolean(),
  expiresAt: z.string().optional(),
});

export type UpsertTenantFeatureFormInput = z.input<typeof upsertFormInputSchema>;

export async function upsertTenantFeatureAction(
  tenantId: string,
  input: unknown,
): Promise<UpsertTenantFeatureResult> {
  // (1) parse
  const surface = upsertFormInputSchema.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
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

  return upsertTenantFeature(normalised, {
    actorId: asUserId(status.userId),
  });
}
