import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  paymentIntents,
  type PaymentIntentKind,
} from "@/db/schema/payment-intents";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  lockIntentTarget,
  type PaymentIntentObservation,
  type PrepareIntentResult,
} from "@/lib/services/payment-intent-core";
import { observationStatus } from "@/lib/services/payment-intent-order";

import { loadTarget } from "@/lib/services/payment-intent-target";
import {
  ALREADY_PREPARED,
  classifyPreparedIntent,
  findOpen,
} from "@/lib/services/payment-intent-open";
import type { ActionCtx } from "@/lib/auth/context";

// F01 — the durable, server-backed recovery surface for ONE counter
// operation. The row is committed before the financial effect and
// survives a reload, another tab, another browser and another device for
// the same authorised tenant + actor + target.
//
// A new key is NEVER adopted silently from another key's open intent.
// If an open attempt exists under a different key, the caller gets
// already_prepared and must recover the actual key from the server
// read. A new key also carries the last committed intent the operator
// observed; the commit re-checks that observation under the same
// per-target lock, so a commit that landed after the read refuses a
// stale new operation.

const idempotencyKey = z.string().uuid();
const uuid = z.string().uuid();

const STALE_OBSERVATION =
  "The document changed since it was checked. Refresh and choose again.";

export function preparePaymentIntent(
  ctx: ActionCtx,
  input: {
    invoiceId: string;
    idempotencyKey: string;
    fingerprint: string;
    observedIntentId?: string | null;
  },
): Promise<PrepareIntentResult> {
  return prepareIntent(
    ctx,
    "payment",
    input.invoiceId,
    input.idempotencyKey,
    input.fingerprint,
    input.observedIntentId,
  );
}

export function prepareReversalIntent(
  ctx: ActionCtx,
  input: {
    paymentId: string;
    idempotencyKey: string;
    fingerprint: string;
    observedIntentId?: string | null;
  },
): Promise<PrepareIntentResult> {
  return prepareIntent(
    ctx,
    "reversal",
    input.paymentId,
    input.idempotencyKey,
    input.fingerprint,
    input.observedIntentId,
  );
}

function observationOf(
  observedIntentId: string | null | undefined,
): PaymentIntentObservation {
  // Omitting the observation is NOT a bypass. It means the caller read no
  // committed intent, which is validated against the chain exactly like an
  // explicit null; a keyed caller can therefore never create a second
  // unchecked tip. Only historical/tampered rows can still carry
  // `unchecked`, and the commit check validates them too.
  if (observedIntentId === undefined || observedIntentId === null) {
    return { kind: "none", intentId: null };
  }
  return { kind: "committed", intentId: observedIntentId };
}

function observationConflict(): PrepareIntentResult {
  return {
    ok: false,
    error: STALE_OBSERVATION,
    conflict: "stale_observation",
  };
}

async function prepareIntent(
  ctx: ActionCtx,
  kind: PaymentIntentKind,
  targetId: string,
  rawKey: string,
  fingerprint: string,
  observedIntentId: string | null | undefined,
): Promise<PrepareIntentResult> {
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const actorId = ctx.userId;
  const parsedKey = idempotencyKey.safeParse(rawKey);
  if (!parsedKey.success) {
    return {
      ok: false,
      error:
        kind === "payment"
          ? "A payment needs its one-time operation key. Refresh and try again."
          : "A reversal needs its one-time operation key. Refresh and try again.",
    };
  }
  if (!uuid.safeParse(targetId).success) {
    return {
      ok: false,
      error: kind === "payment" ? "Invoice not found." : "Payment not found.",
    };
  }
  const observation = observationOf(observedIntentId);
  if (
    observation.kind === "committed" &&
    !uuid.safeParse(observation.intentId).success
  ) {
    return observationConflict();
  }
  const key = parsedKey.data;
  const notFound =
    kind === "payment" ? "Invoice not found." : "Payment not found.";

  return withTenant<PrepareIntentResult>(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const target = await loadTarget(tx, ctx.tenantId, kind, targetId);
    if (!target || !locationVisible(access, target.locationId)) {
      return { ok: false, error: notFound };
    }

    // ONE per-target lock shared by prepare, commit and cancel. The
    // observation check below and the one-open check are therefore
    // atomic with a concurrent commit for this actor + target.
    await lockIntentTarget(tx, {
      tenantId: ctx.tenantId,
      actorId,
      kind,
      targetId,
    });

    const existing = await tx
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, ctx.tenantId),
          eq(paymentIntents.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return classifyPreparedIntent(existing[0], actorId, kind, targetId, fingerprint);
    }

    const open = await findOpen(tx, ctx.tenantId, actorId, kind, targetId);
    if (open) {
      // B-1: a DIFFERENT key is never adopted, even with an equal
      // payload. The caller must refresh and explicitly continue the
      // open attempt with the server's key.
      if (open.idempotencyKey !== key) {
        return { ok: false, error: ALREADY_PREPARED, conflict: "already_prepared" };
      }
      if (open.payloadFingerprint === fingerprint) {
        return { ok: true, intent: open, created: false };
      }
      return { ok: false, error: ALREADY_PREPARED, conflict: "already_prepared" };
    }

    const status = await observationStatus(
      tx,
      {
        tenantId: ctx.tenantId,
        actorId,
        kind,
        targetId,
      },
      observation,
    );
    if (status === "stale") {
      return observationConflict();
    }

    const inserted = await tx
      .insert(paymentIntents)
      .values({
        tenantId: ctx.tenantId,
        actorId,
        kind,
        idempotencyKey: key,
        invoiceId: kind === "payment" ? targetId : null,
        paymentId: kind === "reversal" ? targetId : null,
        locationId: target.locationId,
        payloadFingerprint: fingerprint,
        observationKind: observation.kind,
        observedIntentId: observation.intentId,
        state: "prepared",
        createdBy: actorId,
        updatedBy: actorId,
      })
      .onConflictDoNothing()
      .returning();
    const intent = inserted[0];
    if (intent) {
      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId,
        action: "payment_intent.prepare",
        entityType: "payment_intent",
        entityId: intent.id,
        after: { kind, targetId, state: "prepared" },
        requestId: ctx.requestId ?? null,
      });
      return { ok: true, intent, created: true };
    }

    // A concurrent request won the key or the one-open-attempt index.
    // ON CONFLICT DO NOTHING waited for that transaction; re-read and
    // answer from it, never mint a replacement or adopt a different key.
    const afterConflict = await tx
      .select()
      .from(paymentIntents)
      .where(
        and(
          eq(paymentIntents.tenantId, ctx.tenantId),
          eq(paymentIntents.idempotencyKey, key),
        ),
      )
      .limit(1);
    if (afterConflict[0]) {
      return classifyPreparedIntent(afterConflict[0], actorId, kind, targetId, fingerprint);
    }
    const openNow = await findOpen(tx, ctx.tenantId, actorId, kind, targetId);
    if (openNow && openNow.idempotencyKey === key) {
      if (openNow.payloadFingerprint === fingerprint) {
        return { ok: true, intent: openNow, created: false };
      }
    }
    return { ok: false, error: ALREADY_PREPARED, conflict: "already_prepared" };
  });
}
