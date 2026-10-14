import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { tenants } from "@/db/schema/tenants";
import { messageLog } from "@/db/schema/message-log";
import { memberNotificationContacts } from "@/lib/services/notification-destinations";
import { getMessageProvider, MESSAGE_COST_PAISE } from "@/lib/messaging/provider";
import { notificationDispatchLock } from "@/lib/messaging/notification-enqueue";
import { writeAudit } from "@/lib/audit/write";
import { staffNotificationAllowed } from "@/lib/messaging/staff-notification-eligibility";
import type { TenantId } from "@/lib/ids";

export async function runWhatsAppNotificationsJob(tenantId: TenantId): Promise<void> {
  z.string().uuid().parse(tenantId);
  const pending = await withTenant(tenantId, (tx) => tx.select({ id: outbox.id }).from(outbox)
    .where(and(eq(outbox.tenantId, tenantId), inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, 5)))
    .orderBy(asc(outbox.createdAt)).limit(20));
  // Commit each recipient separately. A bounded local send holds its row's
  // lock; parallel consumers recheck status after acquiring the lock.
  for (const candidate of pending) await withTenant(tenantId, async (tx) => {
    await notificationDispatchLock(tx, tenantId);
    const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant || !["active", "trial"].includes(tenant.status)) return;
    const [row] = await tx.select().from(outbox).where(and(eq(outbox.id, candidate.id), eq(outbox.tenantId, tenantId),
      inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, 5))).for("update");
    if (!row) return;
    const provider = getMessageProvider();
      let allowed = false;
      if (row.memberId) {
        const result = await memberNotificationContacts(tx, tenantId, row.memberId);
        allowed = Boolean(result && result.member.status !== "left" && (row.essential || result.communicationsAllowed) &&
          result.contacts.some((c) => c.selected && c.phone === row.phone &&
            !((row.audience === "guardians" || (row.essential && result.minor)) && c.personId === result.member.personId)));
      } else if (row.recipientUserId) {
        allowed = await staffNotificationAllowed(tx, row);
      }
      let status = "suppressed";
      let providerMessageId: string | null = null;
      let error: string | null = null;
      if (allowed) {
        try {
          if (!provider) throw new Error("No WhatsApp provider is configured.");
          const sent = await provider.send({ tenantId, toPhone: row.phone, body: row.body, category: "utility" });
          providerMessageId = sent.providerMessageId;
          status = "sent";
        } catch (cause) {
          status = "failed";
          error = cause instanceof Error ? cause.message : "WhatsApp send failed.";
        }
        if (provider) await tx.insert(messageLog).values({ tenantId, direction: "outbound", provider: provider.name,
          providerMessageId, toPhone: row.phone, body: row.body, status, error, category: "utility",
          costPaise: status === "sent" ? MESSAGE_COST_PAISE.utility : 0n });
      }
      await tx.update(outbox).set({ status, attempts: row.attempts + 1, error,
        sentAt: status === "sent" ? new Date() : null }).where(eq(outbox.id, row.id));
      await writeAudit(tx, { tenantId, actorId: null, action: `whatsapp.notification.${status}`,
        entityType: "whatsapp_notification", entityId: row.id, after: { eventKey: row.eventKey, attempts: row.attempts + 1 } });
  });
}
