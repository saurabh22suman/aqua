import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  announcements,
  notifications,
  type AnnouncementAudience,
} from "@/db/schema/announcements";
import { batches } from "@/db/schema/programs";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { resolveAudienceUserIds } from "@/lib/services/announcement-audience";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import {
  callerHasPermission,
  callerIsLegacySystem,
} from "@/lib/services/resource-access";
import { enqueueAnnouncementNotifications } from "@/lib/messaging/notification-events";

// U-06 — announcements and the in-app notification fan-out.
//
// Audience resolution (Release 1, deliberately simple and documented):
//   * `all`     — every active tenant membership (staff/dashboard
//                 accounts) PLUS every user linked through
//                 users.person_id to an active member or to a
//                 guardian of one. In R1 most families use the
//                 zero-JS token link and have no user row; that
//                 case simply resolves to no row for them.
//   * `batch`   — every user linked to a person enrolled in the
//                 batch, or to a guardian of one.
//   * `parents` — every user linked to a guardian of an active
//                 member.
// WhatsApp destinations are queued atomically alongside in-app rows.
// The worker rechecks contact preferences and consent before transport.

export const sendAnnouncementInput = z
  .object({
    title: z.string().trim().min(1, "Give the announcement a title.").max(160),
    body: z.string().trim().min(1, "Write the announcement.").max(4000),
    audience: z.enum(["all", "batch", "parents"]),
    batchId: z.string().uuid().optional(),
  })
  .refine((v) => v.audience !== "batch" || Boolean(v.batchId), {
    message: "Pick the batch this announcement goes to.",
    path: ["batchId"],
  })
  .refine((v) => v.audience === "batch" || v.batchId === undefined, {
    message: "A batch id only applies to a batch announcement.",
    path: ["batchId"],
  });

export type SendAnnouncementInput = z.input<typeof sendAnnouncementInput>;

export type SendAnnouncementResult =
  | { ok: true; id: string; recipientCount: number; whatsappRecipientCount?: number }
  | { ok: false; error: string };

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  batchId: string | null;
  batchName: string | null;
  sentAt: string | null;
  recipientCount: number;
};

export type NotificationRow = {
  id: string;
  title: string;
  body: string;
  announcementId: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function sendAnnouncement(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SendAnnouncementResult> {
  const parsed = sendAnnouncementInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid announcement." };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    // R03 (2026-10-09 role/content/permission audit) — a sender without
    // settings.manage (e.g. reception, which holds messaging.send) may
    // only reach a batch at a location visible to them; academy-wide
    // audiences ("all", "parents") stay with Owner/Admin. Identity-free
    // legacy/system callers keep the old behaviour — the action layer
    // remains the authorization boundary, the same trust model as
    // resolveLocationAccess.
    const canManage =
      callerIsLegacySystem(ctx) ||
      (await callerHasPermission(tx, ctx, "settings.manage"));

    if (!canManage && input.audience !== "batch") {
      return {
        ok: false,
        error: "Only the academy owner or admin can send this announcement.",
      };
    }

    if (input.audience === "batch") {
      const batchRows = await tx
        .select({ id: batches.id, locationId: batches.locationId })
        .from(batches)
        .where(
          and(
            eq(batches.id, input.batchId!),
            eq(batches.tenantId, ctx.tenantId),
            isNull(batches.deletedAt),
          ),
        )
        .limit(1);
      if (!batchRows[0]) return { ok: false, error: "Batch not found." };
      if (!canManage) {
        const access = await resolveLocationAccess(tx, ctx);
        // A batch with no location is academy-wide, visible to scoped
        // staff by the shared helper's NULL rule; for a non-manager
        // that widening is exactly what R03 keeps with the owner, so
        // it is refused here rather than delegated.
        if (
          batchRows[0].locationId === null ||
          !locationVisible(access, batchRows[0].locationId)
        ) {
          return {
            ok: false,
            error: "You can only send announcements to batches at your location.",
          };
        }
      }
    }

    const userIds = await resolveAudienceUserIds(
      tx,
      ctx.tenantId,
      input.audience,
      input.batchId,
    );

    const announcementId = uuidv7();
    const now = new Date();
    await tx.insert(announcements).values({
      id: announcementId,
      tenantId: ctx.tenantId,
      title: input.title,
      body: input.body,
      audience: input.audience,
      batchId: input.batchId ?? null,
      sentAt: now,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });

    for (let i = 0; i < userIds.length; i += 500) {
      const chunk = userIds.slice(i, i + 500);
      await tx.insert(notifications).values(
        chunk.map((userId) => ({
          id: uuidv7(),
          tenantId: ctx.tenantId,
          userId,
          announcementId,
          title: input.title,
          body: input.body,
          createdAt: now,
        })),
      );
    }

    const whatsappRecipientCount = await enqueueAnnouncementNotifications(tx, {
      tenantId: ctx.tenantId, announcementId, ...input,
    });
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "announcement.send",
      entityType: "announcement",
      entityId: announcementId,
      after: {
        audience: input.audience,
        batchId: input.batchId ?? null,
        recipientCount: userIds.length,
        channel: "in_app",
        whatsappRecipientCount,
      },
      requestId: ctx.requestId,
    });

    return { ok: true, id: announcementId, recipientCount: userIds.length, whatsappRecipientCount };
  });
}

export async function listAnnouncements(ctx: ActionCtx): Promise<AnnouncementRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        audience: announcements.audience,
        batchId: announcements.batchId,
        batchName: batches.name,
        sentAt: announcements.sentAt,
        recipientCount: sql<number>`(
          select count(*)::int from notifications n
          where n.tenant_id = ${ctx.tenantId}
            and n.announcement_id = ${announcements.id}
        )`,
      })
      .from(announcements)
      .leftJoin(
        batches,
        and(eq(batches.id, announcements.batchId), eq(batches.tenantId, ctx.tenantId)),
      )
      .where(eq(announcements.tenantId, ctx.tenantId))
      .orderBy(desc(announcements.sentAt), desc(announcements.createdAt))
      .limit(50);

    return rows.map((r) => ({
      ...r,
      audience: r.audience as AnnouncementAudience,
      sentAt: r.sentAt?.toISOString() ?? null,
    }));
  });
}

export async function listMyNotifications(ctx: ActionCtx): Promise<NotificationRow[]> {
  if (!ctx.userId) return [];
  return withTenant(ctx.tenantId, async (tx) =>
    (
      await tx
        .select({
          id: notifications.id,
          title: notifications.title,
          body: notifications.body,
          announcementId: notifications.announcementId,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(
          and(
            eq(notifications.tenantId, ctx.tenantId),
            eq(notifications.userId, ctx.userId!),
          ),
        )
        .orderBy(desc(notifications.createdAt))
        .limit(50)
    ).map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      announcementId: r.announcementId,
      readAt: r.readAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
}

export async function markNotificationRead(
  ctx: ActionCtx,
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.string().uuid().safeParse(notificationId);
  if (!parsed.success) return { ok: false, error: "Notification not found." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, parsed.data),
          eq(notifications.tenantId, ctx.tenantId),
          eq(notifications.userId, ctx.userId!),
        ),
      )
      .returning({ id: notifications.id });
    if (!rows[0]) return { ok: false, error: "Notification not found." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: "notification.read",
      entityType: "notification",
      entityId: parsed.data,
      requestId: ctx.requestId,
    });
    return { ok: true };
  });
}
