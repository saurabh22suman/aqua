"use server";

import { z } from "zod";
import {
  removeSampleData,
  type RemoveSampleDataResult,
} from "@/db/preset-sample-data";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// Phase 2.3 — server action for the "Remove sample data" button
// on the tenant detail page. Standing-rule pattern: (1) parse
// the surface shape (here the input is just a tenant id, validated
// as a uuid), (2) check the platform session, (3) call the
// service. The result kind drives the inline UI:
//   - 'ok'             → router.refresh; the preset-engine's
//                          sample rows are gone.
//   - 'lock_active'    → the page already hides the button when a
//                          real row exists, so reaching this branch
//                          means the operator used a stale route;
//                          the inline error pill explains.
//   - 'tenant_not_found' / 'invalid' / 'error' — defensive
//                          fall-through.

const removeFormInput = z.object({
  tenantId: z.string().uuid(),
});

export type RemoveSampleDataActionResult =
  | RemoveSampleDataResult
  | { kind: "error"; code: "invalid"; message: string };

export async function removeSampleDataAction(
  input: unknown,
): Promise<RemoveSampleDataActionResult> {
  // (1) parse
  const surface = removeFormInput.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Invalid tenant reference.",
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

  // (3) service
  return removeSampleData(surface.data.tenantId as never, {
    actorId: status.userId as never,
  });
}
