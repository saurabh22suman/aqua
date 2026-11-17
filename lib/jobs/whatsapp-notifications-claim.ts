import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { tenants } from "@/db/schema/tenants";
import { memberNotificationContacts } from "@/lib/services/notification-destinations";
import { notificationDispatchLock } from "@/lib/messaging/notification-enqueue";
import { writeAudit } from "@/lib/audit/write";
import { staffNotificationAllowed } from "@/lib/messaging/staff-notification-eligibility";
import type { TenantId } from "@/lib/ids";

// F09 (composed, rev 9) — the claim step, split from
// whatsapp-notifications-job.ts to keep each module below 300 lines.
// The behaviour is unchanged: the tenant advisory lock and `for update`
// come first, the consent/eligibility re-check runs in the SAME claim
// transaction, and the conditional update carries a fresh CLAIM TOKEN
// that fences the later finalise.

export const MAX_ATTEMPTS = 5;

export type Claim = {
  id: string;
  phone: string;
  body: string;
  eventKey: string;
  attempts: number;
  // The FENCE TOKEN of this claim. The attempt counter is NOT unique per
  // claim — an operator resend resets it to 0 — so the finalise matches
  // on the token. A stale worker's token can never equal a newer claim's
  // token, so a late finalise can never overwrite a row another
  // dispatcher is sending.
  claimToken: string;
  // The ledger attribution (F7), carried on the claim so the ledger row
  // can be written without re-reading the outbox.
  consentClass: "essential" | "suppressible";
  personId: string | null;
};

// The claim's result is DISCRIMINATED, so the run's summary can tell a
// consent suppression from a row another dispatcher is holding. Before
// this, a suppression was counted as "skipped" and the suppressed counter
// was permanently zero — the exact signal an operator needs when they are
// debugging a suppression.
export type ClaimResult =
  | { kind: "claimed"; claim: Claim }
  | { kind: "suppressed" }
  | { kind: "taken" };

/**
 * Step 1 — claim one row. The tenant status, the member's consent and
 * the staff eligibility are re-checked HERE, in the claim transaction,
 * immediately before the send. A row that is not allowed is suppressed,
 * never sent.
 */
export async function claimRow(tenantId: TenantId, id: string): Promise<ClaimResult> {
  return withTenant(tenantId, async (tx) => {
    await notificationDispatchLock(tx, tenantId);
    const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant || !["active", "trial"].includes(tenant.status)) return { kind: "taken" };
    const [row] = await tx.select().from(outbox).where(and(eq(outbox.id, id), eq(outbox.tenantId, tenantId),
      inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, MAX_ATTEMPTS))).for("update");
    if (!row) return { kind: "taken" };
    const allowed = await notificationAllowed(tx, tenantId, row);
    if (!allowed) {
      const [suppressed] = await tx.update(outbox)
        .set({ status: "suppressed", attempts: row.attempts + 1, failureReason: "not_allowed" })
        .where(and(eq(outbox.id, row.id), inArray(outbox.status, ["pending", "failed"])))
        .returning({ id: outbox.id });
      if (suppressed) {
        await writeAudit(tx, { tenantId, actorType: "system", actorId: null, source: "job",
          action: "whatsapp.notification.suppressed", entityType: "whatsapp_notification", entityId: suppressed.id,
          after: { eventKey: row.eventKey, attempts: row.attempts + 1, reason: "not_allowed" } });
      }
      return { kind: "suppressed" };
    }
    // The conditional update IS the claim: exactly one dispatcher can
    // move a row out of pending|failed, and the returned row carries the
    // CLAIM TOKEN that fences the finalise. The token is a fresh uuid,
    // so it identifies THIS claim and no other: the attempt counter
    // cannot do that job, because an operator resend resets it to 0 and
    // a stale worker's finalise would then match a NEWER claim's attempt
    // count.
    const [claimed] = await tx.update(outbox)
      .set({ status: "sending", attempts: row.attempts + 1, claimedAt: new Date(), error: null,
        claimToken: randomUUID() })
      .where(and(eq(outbox.id, row.id), inArray(outbox.status, ["pending", "failed"])))
      .returning({ id: outbox.id, phone: outbox.phone, body: outbox.body, eventKey: outbox.eventKey,
        attempts: outbox.attempts, claimToken: outbox.claimToken, essential: outbox.essential,
        recipientPersonId: outbox.recipientPersonId });
    if (!claimed || !claimed.claimToken) return { kind: "taken" };
    return { kind: "claimed", claim: {
      id: claimed.id,
      phone: claimed.phone,
      body: claimed.body,
      eventKey: claimed.eventKey,
      attempts: claimed.attempts,
      claimToken: claimed.claimToken,
      consentClass: claimed.essential ? "essential" : "suppressible",
      personId: claimed.recipientPersonId,
    } };
  });
}

/**
 * The consent / eligibility re-check, unchanged from today's dispatch:
 * the same rows, the same conditions, in the same transaction as the
 * claim and immediately before the send.
 */
async function notificationAllowed(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: TenantId,
  row: { memberId: string | null; recipientUserId: string | null; phone: string; essential: boolean; audience: string },
): Promise<boolean> {
  if (row.memberId) {
    const result = await memberNotificationContacts(tx, tenantId, row.memberId);
    return Boolean(result && result.member.status !== "left" && (row.essential || result.communicationsAllowed) &&
      result.contacts.some((c) => c.selected && c.phone === row.phone &&
        !((row.audience === "guardians" || (row.essential && result.minor)) && c.personId === result.member.personId)));
  }
  if (row.recipientUserId) {
    return staffNotificationAllowed(tx, row as Parameters<typeof staffNotificationAllowed>[1]);
  }
  return false;
}
