"use server";

import { z } from "zod";
import {
  createTenantInput,
  createTenant,
  type CreateTenantResult,
} from "@/db/platform-tenant-create";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId } from "@/lib/ids";

// Phase 1.5 — server action backing `/platform/tenants/new`. Sits
// alongside `lib/actions/platform-auth.ts`; server actions belong
// in this folder, full stop. The new-tenant form posts a plain
// object; the action parses, gates on the platform session, then
// delegates to `createTenant()` in db/.
//
// Per the standing rule (every Server Action opens with (1) parse,
// (2) permission check), the first statement is the input parse.
// The form posts `locationIsPrimary` as `"on"` (HTML checkbox) or
// absent — normalise to a boolean here so the service's zod parses
// cleanly. The deep zod schema is `createTenantInput` from the
// service; this file re-declares only the surface-shape first pass.

const formInputSchema = z.object({
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  planKey: z.string(),
  currency: z.string(),
  gstin: z.string().optional(),
  locationName: z.string(),
  locationIsPrimary: z.boolean(),
});

export type CreateTenantFormInput = z.input<typeof formInputSchema>;

export async function createTenantAction(
  input: unknown,
): Promise<CreateTenantResult> {
  // (1) parse — required preamble. Form posts `locationIsPrimary`
  // as a string when ticked. Coerce and pass into the service
  // schema, which is the source of truth for validation.
  const surface = formInputSchema.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: "Please complete every field before saving.",
    };
  }
  const normalised: z.input<typeof createTenantInput> = {
    ...surface.data,
    gstin: surface.data.gstin || undefined,
  };

  // (2) permission check — platform session, fully past 2FA.
  // Anything else (unauthenticated, half-authenticated, expired,
  // suspended) routes back to the operator through login.
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  return createTenant(normalised, { actorId: asUserId(status.userId) });
}
