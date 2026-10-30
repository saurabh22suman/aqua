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
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { recordOpsMutationTrace, recordOpsThrownFailure } from "@/lib/auth/ops-operation";
import { opsAction } from "@/db/ops-action";
import { asUserId, asTenantId } from "@/lib/ids";

// Phase 1.5 + 1.6 — server actions for the operator surface:
// createTenantAction backs /ops/tenants/new; transitionTenantStatus
// backs the controls on /ops/tenants/[tenantId].
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
  // PR1-C6 — the ops form requires an explicit preset choice; the
  // service still validates the key against the catalogue.
  presetKey: z.string().trim().min(1, "Choose a preset."),
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
    presetKey: String(formData.get("presetKey") ?? "").trim(),
  });
  if (!surface.success) {
    await recordOpsMutationTrace("tenant.create", "invalid");
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
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("tenant.create", "denied");
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
      scope: "tenant.create",
      actorId: asUserId(status.userId),
      targetType: "tenant",
      detail: { slug: normalised.slug },
    },
    () => createTenant(normalised, { actorId: asUserId(status.userId) }),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("tenant.create", error);
    throw error;
  });
  if (result.kind === "ok") {
    redirect(`/ops/tenants/${result.tenantId}`);
  } else {
    await recordOpsMutationTrace("tenant.create", "error");
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

// The trace name follows the transition the operator asked for. Each
// branch calls the boundary with a LITERAL operation name: a computed
// name would be a name no coverage check can prove, and the registry
// (lib/auth/ops-operation.ts) is the contract for these operations.
//
// The parse-failure branch above keeps the documented family default
// (tenant.activate), because a malformed request names no transition.
async function traceTransition(
  outcome: "invalid" | "denied" | "error",
  targetStatus: "active" | "suspended" | "churned",
  tenantId?: string,
): Promise<void> {
  if (targetStatus === "suspended") {
    await recordOpsMutationTrace("tenant.suspend", outcome, { tenantId });
    return;
  }
  if (targetStatus === "churned") {
    await recordOpsMutationTrace("tenant.churn", outcome, { tenantId });
    return;
  }
  await recordOpsMutationTrace("tenant.activate", outcome, { tenantId });
}

// The THROWN-failure twin of traceTransition. The original error is
// rethrown by the caller; this only records how the call ended.
async function traceThrownTransition(
  error: unknown,
  targetStatus: "active" | "suspended" | "churned",
  tenantId?: string,
): Promise<void> {
  if (targetStatus === "suspended") {
    await recordOpsThrownFailure("tenant.suspend", error, { tenantId });
    return;
  }
  if (targetStatus === "churned") {
    await recordOpsThrownFailure("tenant.churn", error, { tenantId });
    return;
  }
  await recordOpsThrownFailure("tenant.activate", error, { tenantId });
}

export async function transitionTenantStatusAction(
  tenantId: string,
  input: unknown,
): Promise<TransitionResult> {
  // (1) parse
  const surface = transitionFormInputSchema.safeParse(input);
  if (!surface.success) {
    await recordOpsMutationTrace("tenant.activate", "invalid");
    return {
      kind: "error",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  // Traces follow the parsed target; the parse-failure branch above keeps
  // the documented family default (tenant.activate).
  const normalised: z.input<typeof transitionInput> = {
    targetStatus: surface.data.targetStatus,
    reason: surface.data.reason?.trim() || undefined,
  };

  // (2) permission check — same shape as createTenant.
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await traceTransition("denied", surface.data.targetStatus, tenantId);
    return {
      kind: "error",
      code: "invalid",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }

  const scope =
    surface.data.targetStatus === "active"
      ? ("tenant.activate" as const)
      : surface.data.targetStatus === "suspended"
        ? ("tenant.suspend" as const)
        : ("tenant.churn" as const);

  const result = await opsAction(
    {
      scope,
      actorId: asUserId(status.userId),
      tenantId,
      reason: normalised.reason,
      targetType: "tenant",
      targetId: tenantId,
    },
    () =>
      transitionTenantStatus(asTenantId(tenantId), normalised, {
        actorId: asUserId(status.userId),
      }),
  ).catch(async (error: unknown) => {
    await traceThrownTransition(error, surface.data.targetStatus, tenantId);
    throw error;
  });
  if (result.kind === "ok") {
    revalidatePath(`/ops/tenants/${tenantId}`);
  }
  if (result.kind !== "ok") {
    await traceTransition("error", surface.data.targetStatus, tenantId);
  }
  return result;
}