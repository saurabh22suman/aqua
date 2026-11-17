import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { recordOpsAudit, recordOpsNoop } from "./ops-action";
import {
  actorIsActiveAdmin,
  isAuditedAs,
  lockTenantForCommercialWrite,
  sameInstant,
} from "./platform-tenant-commercial";
import type { TenantId, UserId } from "@/lib/ids";

export const setTenantTrialDeadlineInput = z.object({
  // The instant to store, or null to clear it. The action hands this
  // over already converted from the operator's IST wall time.
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  // REQUIRED. The deadline the operator saw; null means there was none.
  expectedExpiresAt: z.string().datetime({ offset: true }).nullable(),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required for a trial deadline change.")
    .max(500),
});
export type SetTenantTrialDeadlineInput = z.input<
  typeof setTenantTrialDeadlineInput
>;

export type TenantTrialResult =
  | {
      kind: "applied";
      tenantId: TenantId;
      /** False when the recorded deadline already said this (a no-op). */
      changed: boolean;
      expiresAt: Date | null;
    }
  | {
      kind: "refused";
      code:
        | "invalid"
        | "tenant_not_found"
        | "stale"
        | "denied"
        | "not_audited";
      message: string;
    };

export async function setTenantTrialDeadline(
  tenantId: TenantId,
  rawInput: SetTenantTrialDeadlineInput,
  ctx: { actorId: UserId },
): Promise<TenantTrialResult> {
  const parsed = setTenantTrialDeadlineInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "refused",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  // THE GUARD: this write may only run inside its own audited
  // operation, with the same actor and the same tenant.
  if (!isAuditedAs("tenant.trial_deadline.set", ctx.actorId, tenantId)) {
    return {
      kind: "refused",
      code: "not_audited",
      message:
        "This write must run inside the audited tenant.trial_deadline.set operation.",
    };
  }

  const next = input.expiresAt ? new Date(input.expiresAt) : null;
  const expected = input.expectedExpiresAt
    ? new Date(input.expectedExpiresAt)
    : null;

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

    // The stale guard, on this write too: the deadline the operator saw
    // must still be the recorded one. The expected value is REQUIRED, so
    // a form that forgot it is refused rather than trusted.
    if (!sameInstant(current.trialExpiresAt, expected)) {
      return {
        kind: "refused",
        code: "stale",
        message:
          "This tenant's trial deadline changed while this page was open. Reload and try again.",
      };
    }

    if (sameInstant(current.trialExpiresAt, next)) {
      await recordOpsNoop(tx, {
        correlationId: randomUUID(),
        origin: "server_action",
        scope: "tenant.trial_deadline.set",
        actorId: ctx.actorId,
        tenantId,
      });
      return {
        kind: "applied",
        tenantId,
        changed: false,
        expiresAt: next,
      };
    }

    // ONLY the deadline column moves. The tenant's status is NOT
    // touched: setting a deadline does not activate, suspend or bill the
    // club, and the audit row records the unchanged status.
    await tx
      .update(tenants)
      .set({ trialExpiresAt: next, updatedAt: new Date(), updatedBy: ctx.actorId })
      .where(eq(tenants.id, tenantId));

    await recordOpsAudit(tx, {
      action: "tenant.trial_deadline.set",
      actorId: ctx.actorId,
      tenantId,
      targetType: "tenant",
      targetId: tenantId,
      before: {
        trialExpiresAt: current.trialExpiresAt?.toISOString() ?? null,
      },
      after: { trialExpiresAt: next?.toISOString() ?? null },
      detail: {
        outcome: "success", correlationId: randomUUID(), origin: "server_action",
        status: current.status,
        statusChanged: false,
      },
    });

    return {
      kind: "applied",
      tenantId,
      changed: true,
      expiresAt: next,
    };
  });
}
