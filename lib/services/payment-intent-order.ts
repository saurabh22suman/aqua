import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  paymentIntents,
  type PaymentIntent,
  type PaymentIntentKind,
} from "@/db/schema/payment-intents";
import type { TenantId, UserId } from "@/lib/ids";
import type { PaymentIntentObservation } from "./payment-intent-core";

// F01 M-01 — the committed-intent order is the OBSERVED-INTENT CHAIN,
// not a clock. Every new public intent records the committed tip it
// observed. A committed row whose id appears as another committed row's
// observed_intent_id is not the tip. Exactly one tip is the latest; zero
// is "none"; more than one is an invariant break (fail closed).
//
// The chain is stable across app instances because it never compares
// committed_at or created_at. It is a total order under the approved
// invariants: one prepared intent per actor+target, the shared
// actor+target advisory lock, and a server-validated observation on every
// new key. The M-04 hardening proposal freezes the observed link and the
// final marker so the proof is also tamper-evident.

export type CommittedTip =
  | { kind: "none" }
  | { kind: "tip"; intent: PaymentIntent }
  | { kind: "ambiguous" };

export async function latestCommittedTip(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    actorId: UserId;
    kind: PaymentIntentKind;
    targetId: string;
  },
): Promise<CommittedTip> {
  const target =
    input.kind === "payment"
      ? eq(paymentIntents.invoiceId, input.targetId)
      : eq(paymentIntents.paymentId, input.targetId);
  const rows = await tx
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.tenantId, input.tenantId),
        eq(paymentIntents.actorId, input.actorId),
        eq(paymentIntents.kind, input.kind),
        eq(paymentIntents.state, "committed"),
        target,
      ),
    );
  if (rows.length === 0) return { kind: "none" };
  const observedIds = new Set(
    rows
      .map((row) => row.observedIntentId)
      .filter((id): id is string => id !== null),
  );
  const tips = rows.filter((row) => !observedIds.has(row.id));
  if (tips.length === 1) return { kind: "tip", intent: tips[0] };
  return { kind: "ambiguous" };
}

// A new key may only proceed if the committed intent it observed is still
// the UNIQUE committed tip. `unchecked` is a legacy persisted value: it is
// validated like `none` instead of bypassing the check, so an old or
// tampered row cannot silently fork the chain. New prepares never write it.
// Ambiguous, forked or cycled chains fail closed.
export async function observationStatus(
  tx: TenantTx,
  input: {
    tenantId: TenantId;
    actorId: UserId;
    kind: PaymentIntentKind;
    targetId: string;
  },
  observation: PaymentIntentObservation,
): Promise<"ok" | "stale"> {
  const tip = await latestCommittedTip(tx, input);
  if (observation.kind === "unchecked" || observation.kind === "none") {
    return tip.kind === "none" ? "ok" : "stale";
  }
  return tip.kind === "tip" && tip.intent.id === observation.intentId
    ? "ok"
    : "stale";
}
