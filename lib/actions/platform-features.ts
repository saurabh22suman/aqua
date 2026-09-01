"use server";

import { z } from "zod";
import {
  updateFeatureInput,
  updateFeature,
  type UpdateFeatureResult,
} from "@/db/platform-features";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 1.7 — server action for the feature catalogue editor.
// Sits alongside `lib/actions/platform-tenants.ts` — server
// actions live in this folder, full stop. The form posts a
// single feature's editable fields; `key` travels through the
// URL slug (the page is keyed by feature key), not as a hidden
// form field, so a tampered cookie replier can't move an edit
// to a different key.
//
// Standing rule: every Server Action opens with (1) zod-parse
// preamble, (2) platform-session permission check. The
// platform-admin role alone is enough scope for the platform
// surface; the action doesn't read or write any per-tenant
// data, so there's no `withPlatformAdmin()` here — `withPlatform()`
// inside the service is sufficient.

const formInputSchema = z.object({
  name: z.string(),
  category: z.string(),
  status: z.enum(["ga", "beta", "internal"]),
});

export type UpdateFeatureFormInput = z.input<typeof formInputSchema>;

export async function updateFeatureAction(
  featureKey: string,
  input: unknown,
): Promise<UpdateFeatureResult> {
  // (1) parse
  const surface = formInputSchema.safeParse(input);
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
