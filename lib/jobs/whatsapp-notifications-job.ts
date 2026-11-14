import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import type { TenantId } from "@/lib/ids";
import { MAX_ATTEMPTS, claimRow } from "@/lib/jobs/whatsapp-notifications-claim";
import { finaliseClaim, reapStaleClaims, sendClaim } from "@/lib/jobs/whatsapp-notifications-delivery";

// The tenant notification dispatch. One run per tenant per minute
// (lib/jobs/whatsapp-notifications-schedule.ts).
//
// F08+F09 (composed, rev 9) — the delivery outcome of a send is recorded
// BEFORE the send and finalised AFTER it, in three transactions:
//
//   1. CLAIM    — the row moves pending|failed -> sending and its attempt
//      counter advances. COMMITTED ON ITS OWN, and it carries a fresh
//      CLAIM TOKEN. The tenant advisory lock and the row's `for update`
//      are taken first, and the consent / eligibility re-check runs in
//      this same transaction, immediately before the send, on the same
//      rows and with the same conditions as before.
//   2. SEND     — the provider call, outside every transaction.
//   3. FINALISE — sending -> sent | failed | unknown, in one short
//      transaction together with the metered row and the audit row.
//
// WHY: the provider call used to happen inside the transaction that
// recorded the delivery. If the provider accepted the message and the
// transaction then rolled back, the row returned to 'pending' with its
// attempt counter unchanged and the next run delivered the SAME message
// again. The attempt bound never advanced, because it rolled back with
// everything else.
//
// The claim token is the fence. A finalise only updates a row that still
// holds THIS claim (status 'sending' AND the claim token it claimed), so
// a stale worker, a reaper or a second dispatcher can never write over a
// row it does not own, and an audit row is written only when the
// conditional update actually won. The attempt counter is NOT the fence:
// an operator resend resets it, so it is not unique per claim.
//
// DELIVERY GUARANTEE (honest, and deliberately not a standard one): each
// claim results in AT MOST ONE provider call. A row whose outcome is
// unknown is NEVER retried automatically, so a message can be delivered
// once, not at all, or (rarely) twice if the provider accepted it and the
// outcome was lost. This is neither at-least-once nor at-most-once end to
// end. It is "at most one attempt per claim, with every uncertain outcome
// visible and resolved by a human". Recovery is a human decision, not an
// automatic retry.
//
// A provider failure is NOT proof that the message was not accepted: a
// timeout can follow an acceptance. So only an EXPLICIT
// MessageNotAcceptedError is treated as "definitely not sent" (retryable);
// every other failure is recorded as UNKNOWN.
//
// The metered ledger row is ALWAYS written — including when no provider
// is configured — because a failed send that leaves no ledger row is
// invisible to every operator surface. For the definite no-provider
// failure the row is MINIMIZED: nothing was transmitted, so it carries no
// phone and no body (the tenant-scoped outbox row still holds them) and
// its error is a fixed code. For a provider-present failure the
// tenant-scoped ledger row keeps the body and the phone exactly like
// every other ledger row; the PLATFORM projection over those rows masks
// the phone, drops the body and returns the classified reason.
export async function runWhatsAppNotificationsJob(tenantId: TenantId): Promise<void> {
  z.string().uuid().parse(tenantId);
  const summary = { sent: 0, suppressed: 0, failed: 0, unknown: 0, skipped: 0 };
  const candidates = await withTenant(tenantId, (tx) => tx.select({ id: outbox.id }).from(outbox)
    .where(and(eq(outbox.tenantId, tenantId), inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt)).limit(20));
  // One recipient at a time: the claim, the send and the finalise of a
  // row are consecutive, so the eligibility re-check is never separated
  // from the send it guards by another row's queueing.
  for (const candidate of candidates) {
    // Counted only after the transaction has committed, so a rolled
    // back send can never be reported as a delivery.
    let outcome: keyof typeof summary = "skipped";
    const claimResult = await claimRow(tenantId, candidate.id);
    if (claimResult.kind === "suppressed") {
      outcome = "suppressed";
    } else if (claimResult.kind === "claimed") {
      const sent = await sendClaim(tenantId, claimResult.claim);
      await finaliseClaim(tenantId, claimResult.claim, sent);
      outcome =
        sent.kind === "sent" ? "sent" : sent.kind === "not_sent" ? "failed" : "unknown";
    }
    // "taken" (another dispatcher holds the row) stays "skipped" — it is
    // NOT a suppression, and the two must never share a counter.
    summary[outcome] += 1;
  }
  await reapStaleClaims(tenantId);
  // A notification that failed MAX_ATTEMPTS times is never selected
  // again, so it can never appear in a run's own outcome: it is the
  // terminal state a support operator has to be able to see. It is
  // COUNTED here, not fixed here — the recovery path (retry, resend,
  // close) is an operator decision, and it is audited.
  const [exhausted] = await withTenant(tenantId, (tx) => tx.select({ n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.tenantId, tenantId), eq(outbox.status, "failed"), gte(outbox.attempts, MAX_ATTEMPTS))));
  const [unknown] = await withTenant(tenantId, (tx) => tx.select({ n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.tenantId, tenantId), eq(outbox.status, "unknown"))));
  console.log(
    `[whatsapp.notifications] tenant ${tenantId}: ${summary.sent} sent, ${summary.suppressed} suppressed, ` +
    `${summary.failed} failed, ${summary.unknown} unknown, ${summary.skipped} skipped, ` +
    `${exhausted?.n ?? 0} exhausted, ${unknown?.n ?? 0} unknown outstanding`,
  );
}
