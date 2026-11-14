"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  assignTenantPlan,
  type TenantPlanResult,
} from "@/db/platform-tenant-plan";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import {
  recordOpsMutationTrace,
  recordOpsThrownFailure,
} from "@/lib/auth/ops-operation";
import { opsAction } from "@/db/ops-action";
import { asTenantId, asUserId } from "@/lib/ids";

const assignPlanFormInputSchema = z.object({
  tenantId: z.string().uuid(),
  planKey: z.string().trim().min(1, "Choose a plan."),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required for a plan change."),
  // REQUIRED: the plan the operator saw. An empty field means the club
  // had no plan. A MISSING field fails the parse, so a form that lost
  // the value can never slip past the stale guard.
  expectedPlanId: z.string().uuid().or(z.literal("").transform(() => null)),
});

export async function assignTenantPlanAction(
  _prev: unknown,
  formData: FormData,
): Promise<TenantPlanResult> {
  // (1) parse
  const expectedPlanId = formData.get("expectedPlanId");
  const surface = assignPlanFormInputSchema.safeParse({
    tenantId: String(formData.get("tenantId") ?? ""),
    planKey: String(formData.get("planKey") ?? ""),
    reason: String(formData.get("reason") ?? ""),
    expectedPlanId:
      expectedPlanId === null ? undefined : expectedPlanId.toString(),
  });
  if (!surface.success) {
    await recordOpsMutationTrace("tenant.plan.reassign", "invalid");
    return {
      kind: "refused",
      code: "invalid",
      message: surface.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  // (2) platform session, fully past 2FA.
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("tenant.plan.reassign", "denied");
    return {
      kind: "refused",
      code: "denied",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }

  const result = await opsAction(
    {
      scope: "tenant.plan.reassign",
      actorId: asUserId(status.userId),
      tenantId: surface.data.tenantId,
      reason: surface.data.reason,
      targetType: "tenant",
      targetId: surface.data.tenantId,
      detail: { planKey: surface.data.planKey },
    },
    () =>
      assignTenantPlan(asTenantId(surface.data.tenantId), {
        planKey: surface.data.planKey,
        reason: surface.data.reason,
        expectedPlanId: surface.data.expectedPlanId,
      }, {
        actorId: asUserId(status.userId),
      }),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("tenant.plan.reassign", error, {
      tenantId: surface.data.tenantId,
    });
    throw error;
  });

  if (result.kind === "applied") {
    revalidatePath(`/ops/tenants/${surface.data.tenantId}`);
    return result;
  }

  // The ONE refusal event. The outcome vocabulary is the canonical one:
  // denied, invalid, error — never "applied" or "refused" in the row.
  await recordOpsMutationTrace(
    "tenant.plan.reassign",
    result.code === "denied"
      ? "denied"
      : result.code === "not_audited"
        ? "error"
        : "invalid",
    { tenantId: surface.data.tenantId },
  );
  return result;
}
