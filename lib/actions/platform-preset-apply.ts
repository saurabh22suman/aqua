"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  applyPreset,
  type ApplyPresetResult,
} from "@/db/preset-engine";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 2.2b — applyPreset server action. The form on
// /platform/presets and the picker on the tenant detail page
// both call this. The result kind drives the inline CTA flow:
//   - 'ok'             → redirect to the tenant detail page so the
//                          operator sees the seeded state.
//   - 'lock_active'    → the picker shows a verb CTA "Edit seeded
//                          data by hand" because the engine has
//                          refused.
//   - 'preset_not_found' / 'tenant_not_found' / 'error' → returned
//                          to useActionState for inline display.
//
// Standing rule: (1) parse, (2) platform-session permission check,
// (3) service. H1 — input is FormData; the preset key comes in via
// a hidden field so the server re-validates it (a tampered cookie
// replier can't target a different preset than the page indicates).

const applyFormInput = z.object({
  tenantId: z.string().uuid(),
  featureKey: z.string().trim().min(1).max(60),
});

export type ApplyPresetFormInput = z.input<typeof applyFormInput>;

export type ApplyPresetActionResult =
  | ApplyPresetResult
  | { kind: "error"; code: "invalid"; message: string };

export async function applyPresetAction(
  _prev: unknown,
  formData: FormData,
): Promise<ApplyPresetActionResult> {
  // (1) parse
  const surface = applyFormInput.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    featureKey: String(formData.get("featureKey") ?? ""),
  });
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Choose a valid preset and tenant.",
    };
  }

  // (2) platform-session permission check
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  // (3) engine
  const result = await applyPreset(surface.data.tenantId as never, surface.data.featureKey, {
    actorId: asUserId(status.userId),
  });
  if (result.kind === "ok") {
    redirect(`/platform/tenants/${surface.data.tenantId}`);
  }
  return result;
}