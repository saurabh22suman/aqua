import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  paymentIntents,
  type PaymentIntentKind,
} from "@/db/schema/payment-intents";
import { type InvoiceStatus } from "@/db/schema/invoices";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  lockIntentTarget,
  markIntentCancelled,
} from "@/lib/services/payment-intent-core";
import { latestCommittedTip } from "@/lib/services/payment-intent-order";
import { loadTarget } from "@/lib/services/payment-intent-target";
import type { ActionCtx } from "@/lib/auth/context";

// F01 — the authenticated, read-only recovery surface and the explicit
// discard of ONE prepared attempt. The server is the source of truth:
// this file never creates an intent and never writes a financial row.

const uuid = z.string().uuid();

export type PaymentIntentRecovery = {
  open: {
    intentId: string;
    idempotencyKey: string;
    createdAt: string;
  } | null;
  lastCommitted: {
    intentId: string;
    idempotencyKey: string;
    // Application-recorded timestamp. It is NOT the ordering proof: the
    // observed-intent chain decides the order, and a lagging app clock can
    // display an earlier time for a later operation.
    committedAt: string;
    resultId: string;
    invoiceStatus: InvoiceStatus | null;
  } | null;
  // True when the committed chain has zero tips (a cycle) or more than
  // one tip (a fork). New keys are refused; this slice has no repair
  // path, so the surface states it honestly instead of showing "none".
  ambiguous?: true;
};

export type CancelIntentResult =
  | { ok: true; intentId: string; replayed: boolean }
  | { ok: false; error: string };

export async function listPaymentIntentRecovery(
  ctx: ActionCtx,
  kind: PaymentIntentKind,
  targetId: string,
): Promise<PaymentIntentRecovery> {
  const empty: PaymentIntentRecovery = { open: null, lastCommitted: null };
  if (!ctx.userId) return empty;
  const actorId = ctx.userId;
  if (!uuid.safeParse(targetId).success) return empty;

  return withTenant<PaymentIntentRecovery>(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const target = await loadTarget(tx, ctx.tenantId, kind, targetId);
    if (!target || !locationVisible(access, target.locationId)) return empty;

    const targetPredicate =
      kind === "payment"
        ? eq(paymentIntents.invoiceId, targetId)
        : eq(paymentIntents.paymentId, targetId);
    const scope = and(
      eq(paymentIntents.tenantId, ctx.tenantId),
      eq(paymentIntents.actorId, actorId),
      eq(paymentIntents.kind, kind),
      targetPredicate,
    );

    const openRows = await tx
      .select({
        id: paymentIntents.id,
        idempotencyKey: paymentIntents.idempotencyKey,
        createdAt: paymentIntents.createdAt,
      })
      .from(paymentIntents)
      .where(and(scope, eq(paymentIntents.state, "prepared")))
      .orderBy(desc(paymentIntents.createdAt))
      .limit(1);

    const tip = await latestCommittedTip(tx, {
      tenantId: ctx.tenantId,
      actorId,
      kind,
      targetId,
    });

    const open = openRows[0]
      ? {
          intentId: openRows[0].id,
          idempotencyKey: openRows[0].idempotencyKey,
          createdAt: openRows[0].createdAt.toISOString(),
        }
      : null;
    const committed = tip.kind === "tip" ? tip.intent : null;
    const lastCommitted =
      committed && committed.committedAt && committed.resultId
        ? {
            intentId: committed.id,
            idempotencyKey: committed.idempotencyKey,
            committedAt: committed.committedAt.toISOString(),
            resultId: committed.resultId,
            invoiceStatus: target.invoiceStatus,
          }
        : null;
    if (tip.kind === "ambiguous") {
      // Zero tips (a cycle) or multiple tips (a fork): not a clean
      // "none", and not a latest operation. Surface it so the operator
      // is not told there is nothing to recover while new keys fail.
      return { open, lastCommitted: null, ambiguous: true };
    }
    return { open, lastCommitted };
  });
}

export async function cancelPaymentIntent(
  ctx: ActionCtx,
  kind: PaymentIntentKind,
  rawIntentId: string,
): Promise<CancelIntentResult> {
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;
  const parsed = uuid.safeParse(rawIntentId);
  if (!parsed.success) return { ok: false, error: "Attempt not found." };

  return withTenant<CancelIntentResult>(ctx.tenantId, async (tx) => {
    // Read the intent once to find its target, then take the SAME
    // per-target advisory lock used by prepare/commit, then lock and
    // re-check the row. The order (target advisory -> intent row) is
    // consistent with commit (target advisory -> target row -> intent
    // row); no deadlock and no unrelated-target block.
    const pre = await tx
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, ctx.tenantId),
          eq(paymentIntents.id, parsed.data),
        ),
      )
      .limit(1);
    const before = pre[0];
    if (!before || before.actorId !== actorId || before.kind !== kind) {
      return { ok: false, error: "Attempt not found." };
    }
    const targetId =
      before.kind === "payment" ? before.invoiceId : before.paymentId;
    if (!targetId) return { ok: false, error: "Attempt not found." };
    await lockIntentTarget(tx, {
      tenantId: ctx.tenantId,
      actorId,
      kind,
      targetId,
    });

    const rows = await tx
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, ctx.tenantId),
          eq(paymentIntents.id, parsed.data),
        ),
      )
      .for("update");
    const intent = rows[0];
    if (
      !intent ||
      intent.actorId !== actorId ||
      intent.kind !== kind
    ) {
      return { ok: false, error: "Attempt not found." };
    }

    const access = await resolveLocationAccess(tx, ctx);
    const target = await loadTarget(tx, ctx.tenantId, intent.kind, targetId);
    if (!target || !locationVisible(access, target.locationId)) {
      return { ok: false, error: "Attempt not found." };
    }
    if (intent.state === "committed") {
      return {
        ok: false,
        error: "This attempt already recorded money; it cannot be discarded.",
      };
    }
    if (intent.state === "cancelled") {
      return { ok: true, intentId: intent.id, replayed: true };
    }

    const cancelled = await markIntentCancelled(tx, {
      tenantId: ctx.tenantId,
      intentId: intent.id,
      actorId,
    });
    if (!cancelled) {
      return { ok: false, error: "The attempt could not be discarded." };
    }
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId,
      action: "payment_intent.cancel",
      entityType: "payment_intent",
      entityId: intent.id,
      before: { state: "prepared" },
      after: { state: "cancelled" },
      requestId: ctx.requestId ?? null,
    });
    return { ok: true, intentId: intent.id, replayed: false };
  });
}
