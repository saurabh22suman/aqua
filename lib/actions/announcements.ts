"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  listAnnouncements,
  listMyNotifications,
  markNotificationRead,
  sendAnnouncement,
  sendAnnouncementInput,
  type AnnouncementRow,
  type NotificationRow,
  type SendAnnouncementResult,
} from "@/lib/services/announcements";

// U-06 — announcement actions. Standing preamble: (1) Zod parse,
// (2) permission check, then the service. Composing needs
// messaging.send (owner/admin hold it); reading one's own in-app
// notifications is a member-level read (members.read).

const notificationInput = z.object({ notificationId: z.string().uuid() });

export async function sendAnnouncementAction(
  raw: unknown,
): Promise<SendAnnouncementResult> {
  const parsed = sendAnnouncementInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid announcement." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "messaging.send");
  return sendAnnouncement(ctx, parsed.data);
}

export async function listAnnouncementsAction(): Promise<AnnouncementRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listAnnouncements(ctx);
}

export async function listMyNotificationsAction(): Promise<NotificationRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listMyNotifications(ctx);
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = notificationInput.safeParse({ notificationId });
  if (!parsed.success) return { ok: false, error: "Notification not found." };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return markNotificationRead(ctx, parsed.data.notificationId);
}
