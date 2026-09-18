import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { batches } from "./programs";
import type { TenantId, UserId } from "@/lib/ids";

// U-06 — announcements and the in-app notification fan-out. See
// db/migrations/20260918125000_u06_announcements.sql for the shape
// rationale (audience check, per-user read state, no DELETE grant).

export type AnnouncementAudience = "all" | "batch" | "parents";

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: text("audience").notNull().$type<AnnouncementAudience>(),
    batchId: uuid("batch_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    check(
      "announcements_title_check",
      sql`char_length(btrim(${t.title})) between 1 and 160`,
    ),
    check(
      "announcements_body_check",
      sql`char_length(btrim(${t.body})) between 1 and 4000`,
    ),
    check(
      "announcements_audience_check",
      sql`${t.audience} in ('all', 'batch', 'parents')`,
    ),
    check(
      "announcements_batch_check",
      sql`(${t.audience} = 'batch') = (${t.batchId} is not null)`,
    ),
    unique("announcements_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "announcements_batch_tenant_fkey",
      columns: [t.batchId, t.tenantId],
      foreignColumns: [batches.id, batches.tenantId],
    }),
    index("announcements_tenant_sent_idx").on(
      t.tenantId,
      t.sentAt.desc(),
      t.createdAt.desc(),
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    announcementId: uuid("announcement_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("notifications_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "notifications_announcement_tenant_fkey",
      columns: [t.announcementId, t.tenantId],
      foreignColumns: [announcements.id, announcements.tenantId],
    }),
    index("notifications_tenant_user_idx").on(
      t.tenantId,
      t.userId,
      t.createdAt.desc(),
    ),
    index("notifications_tenant_announcement_idx").on(
      t.tenantId,
      t.announcementId,
    ),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
