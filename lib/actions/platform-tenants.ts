"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createTenantInput,
  createTenant,
  type CreateTenantResult,
} from "@/db/platform-tenant-create";

// Re-export so the form component (which calls the action via
// useActionState) can import CreateTenantResult without reaching
// into db/ directly. db/ is server-only; the form is a client island.
export type { CreateTenantResult };
import {
  transitionInput,
  transitionTenantStatus,
  type TransitionResult,
} from "@/db/platform-tenant-status";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { asUserId, asTenantId } from "@/lib/ids";

// Phase 1.5 + 1.6 — server actions for the operator surface:
// createTenantAction backs /platform/tenants/new; transitionTenantStatus
// backs the controls on /platform/tenants/[tenantId].
//
// createTenantAction takes FormData (H1: pre-hydration submit goes
// via POST to the action endpoint, not via native GET with form
// fields in the URL). transitionTenantStatusAction keeps its
// (tenantId, input) signature because the callsite is button-driven
// (no <form> element); it is not vulnerable to the URL leak.
//
// Both open with the (1) zod-parse preamble, (2) platform-session
// permission check — the standing rule every Server Action must follow.

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
  _prev: unknown,
  formData: FormData,
): Promise<CreateTenantResult> {
  // (1) parse — required preamble. Form posts `locationIsPrimary`
  // as a string when ticked; coerce.
  const surface = createFormInputSchema.safeParse({
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "").trim(),
    timezone: String(formData.get("timezone") ?? "").trim(),
    planKey: String(formData.get("planKey") ?? "").trim(),
    currency: String(formData.get("currency") ?? "").trim().toUpperCase(),
    gstin: String(formData.get("gstin") ?? "").trim() || undefined,
    locationName: String(formData.get("locationName") ?? "").trim(),
    locationIsPrimary: formData.get("locationIsPrimary") === "on",
  });
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
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") {
    return {
      kind: "error",
      code: "invalid",
      message: "Your session has expired. Sign in again.",
    };
  }

  const result = await createTenant(normalised, { actorId: asUserId(status.userId) });
  if (result.kind === "ok") {
    redirect(`/platform/tenants/${result.tenantId}`);
  }
  return result;
}

// ---- Phase 1.6 — status transitions ----
//
// NOT a Server Action form-pattern call. status-transitions.tsx is
// button-driven (a modal confirm button calls the action via JS);
// there is no <form> element, so this action is not vulnerable to
// the pre-hydration URL leak. The signature stays
// (tenantId, input) so the existing callsite keeps working.

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

  const result = await transitionTenantStatus(asTenantId(tenantId), normalised, {
    actorId: asUserId(status.userId),
  });
  if (result.kind === "ok") {
    revalidatePath(`/platform/tenants/${tenantId}`);
  }
  return result;
}