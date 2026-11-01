import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  paymentIntents,
  type PaymentIntent,
  type PaymentIntentKind,
} from "@/db/schema/payment-intents";
import type { TenantId, UserId } from "@/lib/ids";
import { observationStatus } from "./payment-intent-order";

// F01 — the in-transaction primitives shared by the payment and
// reversal services. The public surface (prepare / status / cancel)
// lives in lib/services/payment-intents.ts; this file holds the
// canonical payload fingerprint and the row lock/mark helpers so both
// money paths use ONE definition of "the same operation".
//
// The fingerprint binds EVERY field the operator submitted, in a fixed
// order, with a version prefix. It is stored instead of the values: the
// complete payload decides identity, while amounts, references and
// reasons stay out of the intent table. The financial row and its audit
// entry keep the values the operator actually submitted.

export const PAYMENT_INTENT_FINGERPRINT_VERSION = "f01.v1";

export type PaymentIntentConflict =
  | "payload_mismatch"
  | "already_recorded"
  | "already_prepared"
  | "cancelled"
  | "stale_observation";

export type PaymentIntentObservation = {
  kind: "unchecked" | "none" | "committed";
  intentId: string | null;
};

export type PrepareIntentResult =
  | { ok: true; intent: PaymentIntent; created: boolean }
  | { ok: false; error: string; conflict?: PaymentIntentConflict };

export type PaymentIntentPayload =
  | {
      kind: "payment";
      invoiceId: string;
      amountPaise: number;
      method: string;
      reference: string | null;
    }
  | {
      kind: "reversal";
      paymentId: string;
      amountPaise: number;
      reason: string;
    };

export function paymentIntentFingerprint(
  payload: PaymentIntentPayload,
): string {
  const canonical: Array<string | number | null> =
    payload.kind === "payment"
      ? [
          PAYMENT_INTENT_FINGERPRINT_VERSION,
          "payment",
          payload.invoiceId,
          payload.amountPaise,
          payload.method,
          payload.reference,
        ]
      : [
          PAYMENT_INTENT_FINGERPRINT_VERSION,
          "reversal",
          payload.paymentId,
          payload.amountPaise,
          payload.reason,
        ];
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function intentMatchesTarget(
  intent: PaymentIntent,
  kind: PaymentIntentKind,
  targetId: string,
): boolean {
  if (intent.kind !== kind) return false;
  return kind === "payment"
    ? intent.invoiceId === targetId
    : intent.paymentId === targetId;
}

// F01 — the one per-target lock shared by prepare, commit and cancel.
// The key is tenant + actor + kind + target: different actors and
// different targets never block each other, and there is no global
// lock. PostgreSQL releases an xact advisory lock on commit/rollback.
export async function lockIntentTarget(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    actorId: UserId;
    kind: PaymentIntentKind;
    targetId: string;
  },
): Promise<void> {
  const key = `${input.tenantId}:${input.actorId}:${input.kind}:${input.targetId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

export type IntentCommitCheck =
  | { status: "committed"; intent: PaymentIntent }
  | { status: "cancelled" }
  | { status: "prepared"; intent: PaymentIntent }
  | { status: "missing" }
  | { status: "mismatch" }
  | { status: "stale_observation" };

// Lock the prepared row for the WHOLE financial transaction. A
// concurrent retry with the same key waits here; the winner commits the
// effect and the committed marker together, and the waiter then sees
// 'committed' and replays instead of writing a second row.
export async function lockIntentForCommit(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    intentId: string;
    actorId: UserId;
    kind: PaymentIntentKind;
    targetId: string;
    fingerprint: string;
  },
): Promise<IntentCommitCheck> {
  const rows = await tx
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.tenantId, input.tenantId),
        eq(paymentIntents.id, input.intentId),
      ),
    )
    .for("update");
  const intent = rows[0];
  if (!intent) return { status: "missing" };
  if (
    intent.actorId !== input.actorId ||
    intent.kind !== input.kind ||
    !intentMatchesTarget(intent, input.kind, input.targetId) ||
    intent.payloadFingerprint !== input.fingerprint
  ) {
    return { status: "mismatch" };
  }
  if (intent.state === "committed") return { status: "committed", intent };
  if (intent.state === "cancelled") return { status: "cancelled" };
  const observation: PaymentIntentObservation = {
    kind: intent.observationKind,
    intentId: intent.observedIntentId,
  };
  if (
    (await observationStatus(
      tx,
      {
        tenantId: input.tenantId,
        actorId: input.actorId,
        kind: input.kind,
        targetId: input.targetId,
      },
      observation,
    )) === "stale"
  ) {
    return { status: "stale_observation" };
  }
  return { status: "prepared", intent };
}

// The committed marker is written in the SAME transaction as the
// financial row, the invoice update, the audit row and the notification.
// If this update can no longer see a prepared row, the whole transaction
// is rolled back: a financial effect must never exist without its
// durable intent result.
export async function markIntentCommitted(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    intentId: string;
    resultId: string;
    actorId: UserId;
  },
): Promise<void> {
  const rows = await tx
    .update(paymentIntents)
    .set({
      state: "committed",
      resultId: input.resultId,
      committedAt: new Date(),
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentIntents.tenantId, input.tenantId),
        eq(paymentIntents.id, input.intentId),
        eq(paymentIntents.state, "prepared"),
      ),
    )
    .returning({ id: paymentIntents.id });
  if (!rows[0]) {
    throw new Error(
      "payment intent commit marker was not written; rolling back the financial effect",
    );
  }
}

export async function markIntentCancelled(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    intentId: string;
    actorId: UserId;
  },
): Promise<string | null> {
  const rows = await tx
    .update(paymentIntents)
    .set({
      state: "cancelled",
      cancelledAt: new Date(),
      updatedBy: input.actorId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentIntents.tenantId, input.tenantId),
        eq(paymentIntents.id, input.intentId),
        eq(paymentIntents.state, "prepared"),
      ),
    )
    .returning({ id: paymentIntents.id });
  return rows[0]?.id ?? null;
}
