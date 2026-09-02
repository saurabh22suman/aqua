"use server";

import { z } from "zod";
import { applyPreset, type ApplyPresetResult } from "@/db/preset-engine";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 2.2b — applyPreset server action. The form on
// /platform/presets and the picker on the tenant detail page
// both call this. The result kind drives the inline CTA flow:
//   - 'ok'             → router.refresh; the detail page now shows
//                          the seeded state.
//   - 'lock_active'    → the picker shows a verb CTA "Edit seeded
//                          data by hand" because the engine has
//                          refused (architecture rule 5 — a real
//                          member exists, OR a different preset was
//                          already applied and switching requires
//                          manual clean-up).
//   - 'preset_not_found' / 'tenant_not_found' → the picker shows a
//                          CTA that the catalogue or the URL is
//                          stale; the form re-loads.
//
// Standing rule (every Server Action opens with (1) parse, (2)
// permission check, then (3) service): the `featureKey` argument
// travels in the URL on /platform/presets/[key] and in the route
// for the tenant detail modal — never from the form body, so a
// tampered cookie replier can't target a different preset than
// the page indicates.

const applyFormInput = z.object({
  tenantId: z.string().uuid(),
  featureKey: z.string().trim().min(1).max(60),
});

export type ApplyPresetFormInput = z.input<typeof applyFormInput>;

// The action's result union is a superset of the engine's. The
// 'invalid' kind is the action-layer pre-screen failure (parse /
// auth) — never the engine's, since the engine never sees a
// surface-malformed input.
export type ApplyPresetActionResult =
  | ApplyPresetResult
  | { kind: "error"; code: "invalid"; message: string };

export async function applyPresetAction(
  input: unknown,
): Promise<ApplyPresetActionResult> {
  // (1) parse — the surface schema is the source of truth for
  // field shape; the engine's own zod schema validates the
  // definition shape inside `applyPreset`.
  const surface = applyFormInput.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Choose a valid preset and tenant.",
    };
  }

  // (2) platform-session permission check. The whole UI is
  // operator-side; tenant users don't reach this action.
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  // (3) engine. The two-transaction shape (create-tenant in
  // withPlatformAdmin, apply in withTenant) is by design — see
  // the architecture's "One transaction" rule. The UI calls
  // createTenantAction first (under the operator's request),
  // then applyPresetAction here.
  return applyPreset(surface.data.tenantId as never, surface.data.featureKey, {
    actorId: asUserId(status.userId),
  });
}
