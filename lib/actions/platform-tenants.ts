"use server";

import { z } from "zod";
import {
  createTenantInput,
  createTenant,
  type CreateTenantResult,
} from "@/db/platform-tenant-create";
import {
  transitionInput,
  transitionTenantStatus,
  type TransitionResult,
} from "@/db/platform-tenant-status";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId, asTenantId } from "@/lib/ids";

// Phase 1.5 + 1.6 — server actions for the operator surface:
// createTenantAction backs /platform/tenants/new; transitionTenantStatus
// backs the controls on /platform/tenants/[tenantId]. Both open
// with the (1) zod-parse preamble, (2) platform-session permission
// check — the standing rule every Server Action must follow.

const createFormInputSchema = z.object({
  name: z.string(),
  slug: z.string(),
  timezone: z.string(),
  planKey: z.string(),
  currency: z.string(),
  gstin: z.string().optional(),
  locationName: z.string(),
  locationIsPrimary: z.boolean(),
});

export type CreateTenantFormInput = z.input<typeof createFormInputSchema>;

export async function createTenantAction(
  input: unknown,
): Promise<CreateTenantResult> {
  // (1) parse — required preamble. Form posts `locationIsPrimary`
  // as a string when ticked. Coerce and pass into the service
  // schema, which is the source of truth for validation.
  const surface = createFormInputSchema.safeParse(input);
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

// ---- Phase 1.6 — status transitions ----

// Surface schema for the status-controls form. tenantId arrives
// from the route parameter on the page; never trust the form to
// supply it (a hidden field is just a cookie replier away).
const transitionFormInputSchema = z.object({
  targetStatus: z.enum(["active", "suspended", "churned"]),
  reason: z.string().optional(),
});

export type TransitionFormInput = z.input<typeof transitionFormInputSchema>;

export async function transitionTenantStatusAction(
  tenantId: string,
  input: unknown,
): Promise<TransitionResult> {
  // (1) parse
  const surface = transitionFormInputSchema.safeParse(input);
  if (!surface.success) {
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const normalised: z.input<typeof transitionInput> = {
    targetStatus: surface.data.targetStatus,
    reason: surface.data.reason?.trim() || undefined,
  };

  // (2) permission check — same shape as createTenant.
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  return transitionTenantStatus(asTenantId(tenantId), normalised, {
    actorId: asUserId(status.userId),
  });
}
