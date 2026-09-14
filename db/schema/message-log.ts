import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// C-40a (payment/messaging decision, 2026-09-14) — the metered message
// log. Written by every outbound send and every inbound receive,
// whichever provider (mock now, WhatsApp Cloud API later). Cost is
// recorded in paise per message from the first row, so metering exists
// before the real bills do (the free service window closes 2026-10-01).

export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    direction: text("direction").notNull(),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    toPhone: text("to_phone"),
    fromPhone: text("from_phone"),
    templateKey: text("template_key"),
    body: text("body"),
    status: text("status").notNull(),
    error: text("error"),
    category: text("category").notNull().default("utility"),
    costPaise: bigint("cost_paise", { mode: "bigint" })
      .notNull()
      .default(0n),
    currency: text("currency").notNull().default("INR"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "message_log_direction_check",
      sql`${t.direction} in ('outbound', 'inbound')`,
    ),
    check(
      "message_log_provider_check",
      sql`${t.provider} in ('mock', 'cloud')`,
    ),
    check(
      "message_log_status_check",
      sql`${t.status} in ('queued', 'sent', 'delivered', 'read', 'failed', 'received')`,
    ),
    check(
      "message_log_category_check",
      sql`${t.category} in ('utility', 'marketing', 'service', 'authentication')`,
    ),
    check("message_log_cost_check", sql`${t.costPaise} >= 0`),
    index("message_log_tenant_idx").on(t.tenantId, t.createdAt.desc()),
    index("message_log_direction_idx").on(t.direction, t.createdAt.desc()),
  ],
);

export type MessageLogRow = typeof messageLog.$inferSelect;
