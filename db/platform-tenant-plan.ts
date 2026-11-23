import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { recordOpsAudit, recordOpsNoop } from "./ops-action";
import { lockEligibleSignupPlan } from "./saas-plan-catalogue";
import {
  actorIsActiveAdmin,
  isAuditedAs,
  lockTenantForCommercialWrite,
} from "./platform-tenant-commercial";
import type { TenantId, UserId } from "@/lib/ids";

export const assignTenantPlanInput = z.object({
  planKey: z
    .string()
    .trim()
    .min(1, "Choose a plan.")
    .max(60),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required for a plan change.")
    .max(500),
  // REQUIRED. The plan the operator saw; null means the club had no
  // plan. A missing value is refused, so a form that lost the field
  // cannot slip past the stale guard.
  expectedPlanId: z.string().uuid().nullable(),
});
export type AssignTenantPlanInput = z.input<typeof assignTenantPlanInput>;

export type TenantPlanResult =
  | {
      kind: "applied";
      tenantId: TenantId;
      /** False when the club was already on that plan (a no-op). */
      changed: boolean;
      planId: string;
      planName: string;
    }
  | {
      kind: "refused";
      code:
        | "invalid"
        | "tenant_not_found"
        | "plan_not_eligible"
        | "stale"
        | "denied"
        | "not_audited";
      message: string;
    };

export async function assignTenantPlan(
  tenantId: TenantId,
  rawInput: AssignTenantPlanInput,
  ctx: { actorId: UserId },
): Promise<TenantPlanResult> {
  const parsed = assignTenantPlanInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "refused",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  // THE GUARD: this write may only run inside its own audited
  // operation, with the same actor and the same tenant. Anywhere else
  // it is refused and writes nothing.
  if (!isAuditedAs("tenant.plan.reassign", ctx.actorId, tenantId)) {
    return {
      kind: "refused",
      code: "not_audited",
      message:
        "This write must run inside the audited tenant.plan.reassign operation.",
    };
  }

  return withPlatformAdmin(async (tx) => {
    const current = await lockTenantForCommercialWrite(tx, tenantId);
    if (!current) {
      return {
        kind: "refused",
        code: "tenant_not_found",
        message: "Tenant not found.",
      };
    }

    if (!(await actorIsActiveAdmin(tx, ctx.actorId))) {
      return {
        kind: "refused",
        code: "denied",
        message: "Your platform account is not an active administrator.",
      };
    }

    // The stale guard: the plan the operator saw must still be the plan
    // the club is on. The expected value is REQUIRED, so this check can
    // never be skipped by a form that forgot to send it.
    if (current.planId !== input.expectedPlanId) {
      return {
        kind: "refused",
        code: "stale",
        message:
          "This tenant's plan changed while this page was open. Reload and try again.",
      };
    }

    // The target plan is locked in SHARE mode and its eligibility is
    // re-checked AFTER the lock is held, so a plan deactivated between
    // the read and the commit cannot be assigned.
    const target = await lockEligibleSignupPlan(tx, input.planKey);
    if (!target) {
      return {
        kind: "refused",
        code: "plan_not_eligible",
        message:
          `"${input.planKey}" is not an active, signup-eligible plan, ` +
          `so it cannot be assigned.`,
      };
    }

    if (target.id === current.planId) {
      // Honest no-op: the club is already on that plan. The evidence is
      // written in THIS transaction, so it commits or rolls back with
      // the mutation.
      await recordOpsNoop(tx, {
        correlationId: randomUUID(),
        origin: "server_action",
        scope: "tenant.plan.reassign",
        actorId: ctx.actorId,
        tenantId,
      });
      return {
        kind: "applied",
        tenantId,
        changed: false,
        planId: target.id,
        planName: target.name,
      };
    }

    // ONLY the plan pointer moves. The club's own per-tenant feature
    // overrides are untouched, and nothing is deleted, enforced or
    // billed.
    await tx
      .update(tenants)
      .set({ planId: target.id, updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(eq(tenants.id, tenantId));

    await recordOpsAudit(tx, {
      action: "tenant.plan.reassign",
      actorId: ctx.actorId,
      tenantId,
      targetType: "tenant",
      targetId: tenantId,
      before: { planId: current.planId, planName: current.planName },
      after: { planId: target.id, planName: target.name },
      detail: {
        outcome: "success", correlationId: randomUUID(), origin: "server_action",
        planKey: target.key,
        from: current.planName ?? null,
        to: target.name,
        overridesKept: true,
      },
    });

    return {
      kind: "applied",
      tenantId,
      changed: true,
      planId: target.id,
      planName: target.name,
    };
  });
}
