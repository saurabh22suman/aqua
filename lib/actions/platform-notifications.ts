"use server";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { opsAction, recordOpsAudit, recordOpsNoop } from "@/db/ops-action";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import {
  recordOpsRejection,
  recordOpsThrownFailure,
  runOpsGlobalRead,
} from "@/lib/auth/ops-operation";
import { withTenant } from "@/db/tenant";
import { writeAudit } from "@/lib/audit/write";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { listNotificationsNeedingAttention } from "@/db/platform-notifications";
import { asTenantId, asUserId } from "@/lib/ids";

// F08 (composed, rev 5) — the operator surface for a notification whose
// delivery outcome is unknown.
//
// NO LAYER OF THIS LANE'S OWN. Every call consumes the CANONICAL boundary
// owned by lane B:
//   * a READ            -> runOpsGlobalRead(operation, read): one `success`
//                          operation row per identified caller, `null` (and
//                          no row) for an anonymous one;
//   * a refusal/invalid -> recordOpsRejection(operation, "denied"|"invalid");
//   * a mutation that failed before committing -> recordOpsMutationTrace(...);
//   * a COMMITTED mutation -> its DOMAIN row, written by recordOpsAudit
//                          inside the transaction; a committed no-op uses
//                          recordOpsNoop, also inside it. NO extra
//                          `ops.operation.*` success row is written: the
//                          domain row already is the evidence.
//
// The two scopes below are the OPS_SCOPES members this proposal adds, and
// the SAME names join B's OpsBoundaryOperation union (one name per
// operation). The detailed status (not_found / stale / resent / closed)
// stays in the bounded DOMAIN detail, never in the operation row.

export type OpsActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const listInput = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });
const mutationInput = z.object({
  notificationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export async function listNotificationsNeedingAttentionAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<Awaited<ReturnType<typeof listNotificationsNeedingAttention>>>> {
  const parsed = listInput.safeParse({ limit: String(formData.get("limit") ?? "").trim() || 50 });
  if (!parsed.success) {
    await recordOpsRejection("notification.list_attention", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.list_attention", "denied");
    return { ok: false, error: "Your platform account has read-only access." };
  }
  const result = await runOpsGlobalRead("notification.list_attention", async () => ({
    ok: true as const,
    value: await listNotificationsNeedingAttention(parsed.data.limit),
  }));
  if (result === null) return { ok: false, error: "Your session has expired. Sign in again." };
  return result;
}

export async function resendUnknownNotificationAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<{ status: string }>> {
  const parsed = mutationInput.safeParse({
    notificationId: String(formData.get("notificationId") ?? ""),
    tenantId: String(formData.get("tenantId") ?? ""),
    reason: String(formData.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    await recordOpsRejection("notification.resend", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.resend", "denied", parsed.data.tenantId);
    return { ok: false, error: "Your platform account has read-only access." };
  }
  return opsAction<OpsActionResult<{ status: string }>>(
    {
      scope: "notification.resend",
      actorId: asUserId(gate.userId),
      tenantId: parsed.data.tenantId,
      targetType: "whatsapp_notification",
      targetId: parsed.data.notificationId,
      reason: parsed.data.reason,
    },
    async () => {
      const tenant = asTenantId(parsed.data.tenantId);
      const correlationId = randomUUID();
      const outcome = await withTenant(tenant, async (tx) => {
        const [row] = await tx
          .select({ id: outbox.id, status: outbox.status, attempts: outbox.attempts })
          .from(outbox)
          .where(and(eq(outbox.id, parsed.data.notificationId), eq(outbox.tenantId, tenant)))
          .for("update");
        // A row that is gone, or in another state, changed NOTHING: the
        // canonical in-transaction no-op evidence, plus the detailed status
        // in the tenant's own domain row.
        if (!row || row.status !== "unknown") {
          // The no-op row IS the evidence for a mutation that changed
          // nothing. It is written in THIS transaction, bound to the
          // ambient operation (same scope, same actor, same tenant).
          await recordOpsNoop(tx, {
            correlationId,
            origin: "server_action",
            scope: "notification.resend",
            actorId: asUserId(gate.userId),
            tenantId: parsed.data.tenantId,
          });
          // The tenant keeps its own record of the platform action; the
          // bound no-op row above is the OPERATION evidence.
          await writeAudit(tx, {
            tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
            action: "ops.whatsapp.resend", entityType: "whatsapp_notification",
            entityId: parsed.data.notificationId, after: {
              outcome: row ? "stale" : "not_found",
              ...(row ? { observedStatus: row.status } : {}),
            },
          });
          return row ? ("stale" as const) : ("not_found" as const);
        }
        await tx.update(outbox).set({
          status: "pending", attempts: 0, error: null, claimedAt: null,
          claimToken: null, failureReason: null, providerMessageId: null,
        }).where(and(eq(outbox.id, row.id), eq(outbox.status, "unknown")));
        // The committed mutation's evidence is the platform row, written
        // inside THIS transaction. writeAudit does NOT bridge to
        // recordOpsAudit: it writes the tenant audit log, which is a
        // different trail and a different table.
        await recordOpsAudit(tx, {
          action: "notification.resend",
          targetType: "whatsapp_notification",
          targetId: row.id,
          before: { status: row.status, attempts: row.attempts },
          after: { outcome: "resent", status: "pending" },
        });
        await writeAudit(tx, {
          tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
          action: "ops.whatsapp.resend", entityType: "whatsapp_notification",
          entityId: row.id, before: { status: row.status, attempts: row.attempts },
          after: { outcome: "resent", status: "pending" },
        });
        return "resent" as const;
      });
      return outcome === "resent"
        ? { ok: true, value: { status: "pending" } }
        : { ok: false, error: "That notification is no longer in the unknown state." };
    },
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("notification.resend", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
}

export async function closeUnknownNotificationAction(
  _prev: unknown,
  formData: FormData,
): Promise<OpsActionResult<{ status: string }>> {
  const parsed = mutationInput.safeParse({
    notificationId: String(formData.get("notificationId") ?? ""),
    tenantId: String(formData.get("tenantId") ?? ""),
    reason: String(formData.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    await recordOpsRejection("notification.close", "invalid");
    return { ok: false, error: "Invalid request." };
  }
  const gate = await requireOpsAdminAction();
  if (gate.kind !== "ok") {
    await recordOpsRejection("notification.close", "denied", parsed.data.tenantId);
    return { ok: false, error: "Your platform account has read-only access." };
  }
  return opsAction<OpsActionResult<{ status: string }>>(
    {
      scope: "notification.close",
      actorId: asUserId(gate.userId),
      tenantId: parsed.data.tenantId,
      targetType: "whatsapp_notification",
      targetId: parsed.data.notificationId,
      reason: parsed.data.reason,
    },
    async () => {
      const tenant = asTenantId(parsed.data.tenantId);
      const correlationId = randomUUID();
      const outcome = await withTenant(tenant, async (tx) => {
        const [row] = await tx
          .select({ id: outbox.id, status: outbox.status, attempts: outbox.attempts })
          .from(outbox)
          .where(and(eq(outbox.id, parsed.data.notificationId), eq(outbox.tenantId, tenant)))
          .for("update");
        if (!row || row.status !== "unknown") {
          await recordOpsNoop(tx, {
            correlationId,
            origin: "server_action",
            scope: "notification.close",
            actorId: asUserId(gate.userId),
            tenantId: parsed.data.tenantId,
          });
          // The tenant keeps its own record of the platform action; the
          // bound no-op row above is the OPERATION evidence.
          await writeAudit(tx, {
            tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
            action: "ops.whatsapp.close_unknown", entityType: "whatsapp_notification",
            entityId: parsed.data.notificationId, after: {
              outcome: row ? "stale" : "not_found",
              ...(row ? { observedStatus: row.status } : {}),
            },
          });
          return row ? ("stale" as const) : ("not_found" as const);
        }
        await tx.update(outbox).set({ status: "suppressed", claimedAt: null, claimToken: null })
          .where(and(eq(outbox.id, row.id), eq(outbox.status, "unknown")));
        // The committed mutation's evidence is the platform row, written
        // inside THIS transaction. writeAudit does NOT bridge to
        // recordOpsAudit: it writes the tenant audit log, a different
        // trail and a different table.
        await recordOpsAudit(tx, {
          action: "notification.close",
          targetType: "whatsapp_notification",
          targetId: row.id,
          before: { status: row.status, attempts: row.attempts },
          after: { outcome: "closed", status: "suppressed" },
        });
        await writeAudit(tx, {
          tenantId: tenant, actorType: "platform", actorId: null, source: "ops",
          action: "ops.whatsapp.close_unknown", entityType: "whatsapp_notification",
          entityId: row.id, before: { status: row.status, attempts: row.attempts },
          after: { outcome: "closed", status: "suppressed" },
        });
        return "closed" as const;
      });
      return outcome === "closed"
        ? { ok: true, value: { status: "suppressed" } }
        : { ok: false, error: "That notification is no longer in the unknown state." };
    },
  ).catch(async (error: unknown) => {
    await recordOpsThrownFailure("notification.close", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
}
