"use server";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  opsAction,
  recordOpsAudit,
  recordOpsNoop,
  type OpsScope,
} from "@/db/ops-action";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import {
  recordOpsRejection,
  recordOpsThrownFailure,
  runOpsGlobalRead,
} from "@/lib/auth/ops-operation";
import { withTenant } from "@/db/tenant";
import { writeAudit } from "@/lib/audit/write";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { listFailedMessages } from "@/db/platform-messages";
import { asTenantId, asUserId, type UserId } from "@/lib/ids";

// F08-B (composed, rev 6) — the operator surface for a FAILED send.
//
// The READ is runOpsGlobalRead (one `success` operation row per identified
// caller); a refusal or a malformed input is recordOpsRejection; a COMMITTED
// mutation's evidence is its DOMAIN row inside the transaction (recordOpsNoop
// for a committed no-op) — never an extra `ops.operation.*` success row.
//
// BOTH exported mutations call the EXISTING opsAction(input, fn) INLINE, so
// the repository's mutation scanner sees it in each exported function and NO
// mutation exemption is requested. The shared worker below holds only the
// transaction logic.
//
// The refusal text is DISTINGUISHED: an unauthenticated caller is told the
// session expired, an identified viewer that the account is read-only.

export type OpsActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const listInput = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const mutationInput = z.object({
  notificationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

function refusalText(reason: "unauthenticated" | "forbidden"): string {
  return reason === "forbidden"
    ? "Your platform account has read-only access."
    : "Your session has expired. Sign in again.";
}

export async function listFailedMessagesAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<Awaited<ReturnType<typeof listFailedMessages>>>> {
  const parsed = listInput.safeParse({ limit: String(formData.get("limit") ?? "").trim() || 50 });
  if (!parsed.success) {
    await recordOpsRejection("notification.list_failed", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.list_failed", "denied");
    return { ok: false, error: refusalText(gate.reason) };
  }
  const result = await runOpsGlobalRead("notification.list_failed", async () => ({
    ok: true as const,
    value: await listFailedMessages(parsed.data.limit),
  }));
  if (result === null) return { ok: false, error: "Your session has expired. Sign in again." };
  return result;
}

type ExhaustedInput = { notificationId: string; tenantId: string; scope: OpsScope; actorId: UserId };

async function mutateExhausted(
  input: ExhaustedInput,
  tenantAuditAction: "ops.whatsapp.retry_failed" | "ops.whatsapp.dismiss_failed",
  success: "pending" | "suppressed",
): Promise<{ ok: true; value: { status: string } } | { ok: false; error: string }> {
  const tenant = asTenantId(input.tenantId);
  const correlationId = randomUUID();
  const outcome = await withTenant(tenant, async (tx) => {
    const [row] = await tx
      .select({ id: outbox.id, status: outbox.status, attempts: outbox.attempts })
      .from(outbox)
      .where(and(eq(outbox.id, input.notificationId), eq(outbox.tenantId, tenant)))
      .for("update");
    if (!row || row.status !== "failed" || row.attempts < 5) {
      // The no-op row IS the evidence for a mutation that changed nothing.
      // It is written in THIS transaction, bound to the ambient operation.
      await recordOpsNoop(tx, {
        correlationId,
        origin: "server_action",
        scope: input.scope,
        actorId: input.actorId,
        tenantId: input.tenantId,
      });
      // The tenant keeps its own record of the platform action; the bound
      // no-op row above is the OPERATION evidence.
      await writeAudit(tx, {
        tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
        action: tenantAuditAction, entityType: "whatsapp_notification",
        entityId: input.notificationId, after: {
          outcome: row ? "stale" : "not_found",
          ...(row ? { observedStatus: row.status } : {}),
        },
      });
      return row ? ("stale" as const) : ("not_found" as const);
    }
    await tx.update(outbox).set({
      status: success,
      attempts: success === "pending" ? 0 : row.attempts,
      error: null, claimedAt: null, claimToken: null,
      failureReason: null, providerMessageId: null,
    }).where(and(eq(outbox.id, row.id), eq(outbox.status, "failed")));
    // The committed mutation's evidence is the platform row, written inside
    // THIS transaction. writeAudit does NOT bridge to recordOpsAudit: it
    // writes the tenant audit log, a different trail and a different table.
    await recordOpsAudit(tx, {
      action: input.scope,
      targetType: "whatsapp_notification",
      targetId: row.id,
      before: { status: row.status, attempts: row.attempts },
      after: { outcome: success === "pending" ? "retried" : "dismissed", status: success },
    });
    await writeAudit(tx, {
      tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
      action: tenantAuditAction, entityType: "whatsapp_notification",
      entityId: row.id, before: { status: row.status, attempts: row.attempts },
      after: { outcome: success === "pending" ? "retried" : "dismissed", status: success },
    });
    return success === "pending" ? ("retried" as const) : ("dismissed" as const);
  });
  return outcome === "retried" || outcome === "dismissed"
    ? { ok: true, value: { status: success } }
    : { ok: false, error: "That notification is not in the failed state." };
}

export async function retryFailedNotificationAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<{ status: string }>> {
  const parsed = mutationInput.safeParse({
    notificationId: String(formData.get("notificationId") ?? ""),
    tenantId: String(formData.get("tenantId") ?? ""),
    reason: String(formData.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    await recordOpsRejection("notification.retry_failed", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.retry_failed", "denied", parsed.data.tenantId);
    return { ok: false, error: refusalText(gate.reason) };
  }
  return opsAction<OpsActionResult<{ status: string }>>(
    {
      scope: "notification.retry_failed",
      actorId: asUserId(gate.userId),
      tenantId: parsed.data.tenantId,
      targetType: "whatsapp_notification",
      targetId: parsed.data.notificationId,
      reason: parsed.data.reason,
    },
    async () =>
      mutateExhausted(
        { notificationId: parsed.data.notificationId, tenantId: parsed.data.tenantId, scope: "notification.retry_failed", actorId: asUserId(gate.userId) },
        "ops.whatsapp.retry_failed",
        "pending",
      ),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("notification.retry_failed", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
}

export async function dismissFailedNotificationAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<{ status: string }>> {
  const parsed = mutationInput.safeParse({
    notificationId: String(formData.get("notificationId") ?? ""),
    tenantId: String(formData.get("tenantId") ?? ""),
    reason: String(formData.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    await recordOpsRejection("notification.dismiss", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.dismiss", "denied", parsed.data.tenantId);
    return { ok: false, error: refusalText(gate.reason) };
  }
  return opsAction<OpsActionResult<{ status: string }>>(
    {
      scope: "notification.dismiss",
      actorId: asUserId(gate.userId),
      tenantId: parsed.data.tenantId,
      targetType: "whatsapp_notification",
      targetId: parsed.data.notificationId,
      reason: parsed.data.reason,
    },
    async () =>
      mutateExhausted(
        { notificationId: parsed.data.notificationId, tenantId: parsed.data.tenantId, scope: "notification.dismiss", actorId: asUserId(gate.userId) },
        "ops.whatsapp.dismiss_failed",
        "suppressed",
      ),
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("notification.dismiss", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
}
