import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  paymentIntents,
  type PaymentIntent,
  type PaymentIntentKind,
} from "@/db/schema/payment-intents";
import { intentMatchesTarget } from "@/lib/services/payment-intent-core";
import type { PrepareIntentResult } from "@/lib/services/payment-intent-core";
import type { TenantId, UserId } from "@/lib/ids";

// F01 — same-layer prepare helpers: the open-attempt lookup and the
// existing-attempt classification. Split out of payment-intents.ts to
// keep the prepare module under the 300-line guideline; no authority,
// scope or query semantics change.

export const ALREADY_PREPARED =
  "An unresolved attempt already exists for this document. Refresh to recover its key, then continue it or discard it.";
const DIFFERENT_DETAILS =
  "This submission was already recorded with different details. Refresh before retrying.";
const OTHER_ATTEMPT =
  "This operation key was already used for another attempt. Refresh before retrying.";
const DISCARDED = "This attempt was discarded. Start a new operation.";

export async function findOpen(
  tx: TenantTx,
  tenantId: TenantId,
  actorId: UserId,
  kind: PaymentIntentKind,
  targetId: string,
): Promise<PaymentIntent | null> {
  const target =
    kind === "payment"
      ? eq(paymentIntents.invoiceId, targetId)
      : eq(paymentIntents.paymentId, targetId);
  const rows = await tx
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.tenantId, tenantId),
        eq(paymentIntents.actorId, actorId),
        eq(paymentIntents.kind, kind),
        eq(paymentIntents.state, "prepared"),
        target,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export function classifyPreparedIntent(
  intent: PaymentIntent,
  actorId: UserId,
  kind: PaymentIntentKind,
  targetId: string,
  fingerprint: string,
): PrepareIntentResult {
  if (
    intent.actorId !== actorId ||
    intent.kind !== kind ||
    !intentMatchesTarget(intent, kind, targetId)
  ) {
    return {
      ok: false,
      error: OTHER_ATTEMPT,
      conflict: "already_recorded",
    };
  }
  if (intent.state === "cancelled") {
    return { ok: false, error: DISCARDED, conflict: "cancelled" };
  }
  if (intent.state === "prepared") {
    // A prepared attempt has NO financial effect. A different payload
    // is therefore "an unresolved attempt exists", not "already
    // recorded": the operator can recover it or discard it.
    if (intent.payloadFingerprint !== fingerprint) {
      return {
        ok: false,
        error: ALREADY_PREPARED,
        conflict: "already_prepared",
      };
    }
    return { ok: true, intent, created: false };
  }
  if (intent.payloadFingerprint !== fingerprint) {
    return {
      ok: false,
      error: DIFFERENT_DETAILS,
      conflict: "payload_mismatch",
    };
  }
  return { ok: true, intent, created: false };
}
