import type { PgBoss } from "pg-boss";

export const WHATSAPP_NOTIFICATIONS_QUEUE = "whatsapp.notifications";

export async function scheduleWhatsAppNotifications(boss: PgBoss, tenantId: string, timezone: string) {
  await boss.schedule(WHATSAPP_NOTIFICATIONS_QUEUE, "* * * * *", { tenantId }, { tz: timezone, key: tenantId });
}
