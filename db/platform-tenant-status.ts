import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withPlatformAdmin } from "./scope";
import { tenants } from "./schema/tenants";
import { platformAuditLog } from "./schema/platform-users";
import type { TenantId, UserId } from "@/lib/ids";

// Phase 1.6 — platform-side tenant status transition. Sibling of
// createTenant (db/platform-tenant-create.ts) and closes the
// cross-tenant write path's UPDATE side. Migration
// 20260902210000_platform_admin_tenant_update.sql adds the RLS
// policy that opens it; this service is the only sanctioned writer
// of tenants.status in the platform surface.
//
// The state machine (kept in lockstep with the schema check
// constraint in db/schema/tenants.ts):
//   trial      → active, suspended, churned
//   active     → suspended, churned
//   suspended  → active, churned
//   churned    → (terminal; no transitions)
//
// Suspended and churned both block tenant logins (see
// lib/actions/auth-ui.ts). The audit row records every transition
// with action 'tenant.activate' / 'tenant.suspend' / 'tenant.churn'
// and a `reason` field on suspended/churned. Reactivation (the
// suspended → active edge) uses the same 'tenant.activate' action;
// the audit detail carries `from: 'suspended'` so the timeline
// reads cleanly.
//
// Single transaction, atomic with the audit row, same invariant as
// createTenant. A row that succeeded and an audit row that didn't
// would be a state nobody could reason about.

const TARGET_STATUS = ["active", "suspended", "churned"] as const;

export const transitionInput = z.object({
  targetStatus: z.enum(TARGET_STATUS),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type TransitionInput = z.input<typeof transitionInput>;

export type TransitionResult =
  | { kind: "ok"; tenantId: TenantId; previousStatus: string }
  | {
      kind: "error";
      code:
        | "invalid"
        | "tenant_not_found"
        | "terminal_state"
        | "no_change"
        | "reason_required";
      message: string;
    };

type TenantStatusFromDb = "trial" | "active" | "suspended" | "churned";

const VALID_TRANSITIONS: Record<
  TenantStatusFromDb,
  ReadonlySet<TenantStatusFromDb>
> = {
  trial: new Set(["active", "suspended", "churned"]),
  active: new Set(["suspended", "churned"]),
  suspended: new Set(["active", "churned"]),
  churned: new Set(),
};

// Suspend and churn demand a reason; activate does not. The reason
// surfaces in the audit row and in `recentActivity` on the operator's
// tenant detail — operators responding to a churn ticket need to
// see *why* from the timeline, not from an out-of-band message.
function reasonRequiredForTarget(to: TenantStatusFromDb): boolean {
  return to === "suspended" || to === "churned";
}

function actionFor(to: TenantStatusFromDb): "tenant.activate" | "tenant.suspend" | "tenant.churn" {
  if (to === "active") return "tenant.activate";
  if (to === "suspended") return "tenant.suspend";
  return "tenant.churn";
}

export async function transitionTenantStatus(
  tenantId: TenantId,
  rawInput: TransitionInput,
  ctx: { actorId: UserId },
): Promise<TransitionResult> {
  const parsed = transitionInput.safeParse(rawInput);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const input = parsed.data;

  if (reasonRequiredForTarget(input.targetStatus) && !input.reason) {
    // Pre-check before the transaction so the caller sees the
    // structured error immediately. The transactional path
    // enforces the same rule below as defense in depth.
    return {
      kind: "error",
      code: "reason_required",
      message: "Reason is required for this status change.",
    };
  }

  return withPlatformAdmin(async (tx) => {
    // SELECT FOR UPDATE locks the row for the rest of the
    // transaction. The lock is released on COMMIT or ROLLBACK and
    // is invisible to the application's connection pool (we are
    // inside withPlatformAdmin's own transaction). Without the
    // lock, two concurrent transitions could both read the same
    // previous status and write to the same audit timeline.
    const rows = await tx.execute<{ status: TenantStatusFromDb }>(sql`
      select status from tenants where id = ${tenantId} for update
    `);
    const read = (rows as unknown as { rows: Array<{ status: TenantStatusFromDb }> })
      .rows[0];
    if (!read) {
      return {
        kind: "error",
        code: "tenant_not_found",
        message: "Tenant not found.",
      };
    }
    const from = read.status;
    const to = input.targetStatus;

    // No-op transition is rejected explicitly — never silently
    // rewrite a row to its current state. The state machine guard
    // (below) would reject this too, but a distinct error code is
    // easier for the operator to act on.
    if (from === to) {
      return {
        kind: "error",
        code: "no_change",
        message: `Tenant is already ${to}.`,
      };
    }

    if (!VALID_TRANSITIONS[from].has(to)) {
      return {
        kind: "error",
        code: "terminal_state",
        message: `Cannot move a tenant from ${from} to ${to}.`,
      };
    }

    if (reasonRequiredForTarget(to) && !input.reason) {
      // Defense in depth — the pre-check above already enforces
      // this, but the in-transaction check means a malformed
      // bypass can't reach the audit insert.
      return {
        kind: "error",
        code: "reason_required",
        message: "Reason is required for this status change.",
      };
    }

    // platforms_admin_update (migration 20260902210000) lets this
    // UPDATE through under withPlatformAdmin. For tenant scoped
    // sessions, tenant_isolation still rejects the write when
    // app.tenant_id ≠ tenantId (the only case a tenant user might
    // open an UPDATE to their own row), and the check constraint
    // validates the new status is one of the four allowed values.
    await tx
      .update(tenants)
      .set({ status: to, updatedBy: ctx.actorId })
      .where(eq(tenants.id, tenantId));

    await tx.insert(platformAuditLog).values({
      actorId: ctx.actorId,
      tenantId,
      action: actionFor(to),
      targetType: "tenant",
      targetId: tenantId,
      detail: {
        from,
        to,
        ...(input.reason ? { reason: input.reason } : {}),
      },
    });

    return {
      kind: "ok",
      tenantId,
      previousStatus: from,
    };
  });
}
