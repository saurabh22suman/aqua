import { and, eq, lte } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { messageLog } from "@/db/schema/message-log";
import {
  getMessageProvider,
  MESSAGE_COST_PAISE,
  MessageNotAcceptedError,
  resolveProviderName,
} from "@/lib/messaging/provider";
import { writeAudit } from "@/lib/audit/write";
import type { TenantId } from "@/lib/ids";
import type { Claim } from "@/lib/jobs/whatsapp-notifications-claim";

// F09 (composed, rev 9) — the send/finalise/reaper steps, split from
// whatsapp-notifications-job.ts. The provider call stays OUTSIDE every
// transaction; the finalise is fenced by the claim token; an unknown
// outcome is never auto-retried; a stale claim becomes 'unknown'.

// A claim older than this is an outcome nobody recorded: the message may
// or may not have been delivered. It is surfaced for a human, never resent
// automatically.
const CLAIM_TIMEOUT_MS = 15 * 60 * 1000;

type FailureReason = "no_provider" | "provider_rejected" | "not_allowed" | "outcome_unknown";

type SendOutcome =
  | { kind: "sent"; providerMessageId: string; providerName: string; reason: null }
  | { kind: "not_sent"; error: string; providerName: string | null; reason: FailureReason }
  | { kind: "unknown"; error: string; providerName: string | null; reason: FailureReason };

/** Step 2 — the provider call, outside every transaction. */
export async function sendClaim(tenantId: TenantId, claim: Claim): Promise<SendOutcome> {
  const provider = getMessageProvider();
  if (!provider) {
    // Nothing was called: the message was definitely not sent, so this
    // is retryable.
    return { kind: "not_sent", error: "No WhatsApp provider is configured.",
      providerName: null, reason: "no_provider" };
  }
  try {
    const sent = await provider.send({ tenantId, toPhone: claim.phone, body: claim.body, category: "utility" });
    return { kind: "sent", providerMessageId: sent.providerMessageId, providerName: provider.name, reason: null };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : "WhatsApp send failed.";
    // Only an EXPLICIT "not accepted" is retryable. Every other failure
    // — a timeout above all — may have happened AFTER the provider
    // accepted the message, so it stays UNKNOWN and is never retried
    // automatically.
    if (cause instanceof MessageNotAcceptedError) {
      return { kind: "not_sent", error, providerName: provider.name, reason: "provider_rejected" };
    }
    return { kind: "unknown", error, providerName: provider.name, reason: "outcome_unknown" };
  }
}

/**
 * Step 3 — record the outcome. The update is fenced by the claim token,
 * so a worker that no longer owns the row updates nothing and writes no
 * audit row.
 */
export async function finaliseClaim(tenantId: TenantId, claim: Claim, outcome: SendOutcome): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const next = outcome.kind === "sent" ? "sent" : outcome.kind === "not_sent" ? "failed" : "unknown";
    const [updated] = await tx.update(outbox).set({
      status: next,
      providerMessageId: outcome.kind === "sent" ? outcome.providerMessageId : null,
      error: outcome.kind === "sent" ? null : outcome.error,
      failureReason: outcome.reason,
      claimedAt: null,
      claimToken: null,
      sentAt: outcome.kind === "sent" ? new Date() : null,
    })
      // The FENCE is the claim token, NOT the attempt counter: the
      // counter is not unique per claim (an operator resend resets it to
      // 0), so a stale worker's finalise could otherwise match a NEWER
      // claim's attempt count and overwrite the row another dispatcher
      // is sending.
      .where(and(eq(outbox.id, claim.id), eq(outbox.status, "sending"), eq(outbox.claimToken, claim.claimToken)))
      .returning({ id: outbox.id });
    if (!updated) return;
    // The metered ledger row is ALWAYS written, including when no
    // provider was configured: a failed send that leaves no ledger row
    // is invisible to every operator surface.
    //
    // For the definite no-provider failure the row is MINIMIZED: nothing
    // was transmitted, so it carries no phone and no body — the
    // tenant-scoped outbox row still holds them — and its error is a
    // fixed code rather than prose.
    //
    // The ledger row carries the OUTCOME AS IT IS. An unknown outcome is
    // NOT a 'failed' row: the failed list reads status='failed', and a
    // row that may already have been delivered must never appear there
    // as safe to retry. This needs message_log's status CHECK to gain
    // 'unknown' — the migration that widens it is part of THIS
    // proposal, so the two land together.
    const providerName = outcome.providerName ?? resolveProviderName();
    const minimized = outcome.reason === "no_provider";
    await tx.insert(messageLog).values({ tenantId, direction: "outbound", provider: providerName,
      providerMessageId: outcome.kind === "sent" ? outcome.providerMessageId : null,
      toPhone: minimized ? null : claim.phone,
      body: minimized ? null : claim.body,
      status: next,
      error: outcome.kind === "sent" ? null : minimized ? "no_provider" : outcome.error,
      category: "utility",
      costPaise: outcome.kind === "sent" ? MESSAGE_COST_PAISE.utility : 0n,
      consentClass: claim.consentClass,
      personId: claim.personId,
      failureReason: outcome.reason });
    // A background job has no human actor: actor_type 'system',
    // actor_id NULL, source 'job' — the shape
    // lib/jobs/subscriptions-expire-job.ts writes. Without this the row
    // claimed to be a web user who does not exist.
    await writeAudit(tx, { tenantId, actorType: "system", actorId: null, source: "job",
      action: `whatsapp.notification.${next}`, entityType: "whatsapp_notification", entityId: updated.id,
      after: { eventKey: claim.eventKey, attempts: claim.attempts,
        ...(outcome.reason ? { reason: outcome.reason } : {}) } });
  });
}

/**
 * A claim nobody finalised (the worker died, the machine restarted) is
 * an unknown outcome. It becomes 'unknown' and is surfaced — it is never
 * resent automatically. The audit row is written ONLY for the rows whose
 * conditional update actually won.
 */
export async function reapStaleClaims(tenantId: TenantId): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const cutoff = new Date(Date.now() - CLAIM_TIMEOUT_MS);
    const reaped = await tx.update(outbox)
      .set({ status: "unknown", failureReason: "outcome_unknown", claimToken: null })
      .where(and(eq(outbox.tenantId, tenantId), eq(outbox.status, "sending"), lte(outbox.claimedAt, cutoff)))
      .returning({ id: outbox.id, eventKey: outbox.eventKey, attempts: outbox.attempts });
    for (const row of reaped) {
      await writeAudit(tx, { tenantId, actorType: "system", actorId: null, source: "job",
        action: "whatsapp.notification.unknown", entityType: "whatsapp_notification", entityId: row.id,
        after: { eventKey: row.eventKey, attempts: row.attempts, reason: "outcome_unknown" } });
    }
  });
}
