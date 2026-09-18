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
// WhatsApp stays the C-40a mock; this service never calls a
// provider. A notification row per resolved user is the whole
// delivery in Release 1.

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
  | { ok: true; id: string; recipientCount: number }
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
    if (input.audience === "batch") {
      const batchRows = await tx
        .select({ id: batches.id })
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
      },
      requestId: ctx.requestId,
    });

    return { ok: true, id: announcementId, recipientCount: userIds.length };
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
