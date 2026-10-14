import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { TenantId, MemberId, PersonId, UserId } from "@/lib/ids";
import { v7 as uuidv7 } from "uuid";

export const whatsappAuthChallenges = pgTable("whatsapp_auth_challenges", {
  tokenHash: text("token_hash").primaryKey(),
  purpose: text("purpose").notNull(),
  phone: text("phone").notNull(),
  principalId: uuid("principal_id"),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  delivered: boolean("delivered").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const whatsappNotificationOutbox = pgTable("whatsapp_notification_outbox", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
  eventKey: text("event_key").notNull(),
  memberId: uuid("member_id").$type<MemberId>(),
  recipientPersonId: uuid("recipient_person_id").$type<PersonId>(),
  recipientUserId: uuid("recipient_user_id").$type<UserId>(),
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  essential: boolean("essential").notNull().default(false),
  audience: text("audience").notNull().default("selected"),
  recipientRole: text("recipient_role"),
  scopeLocationId: uuid("scope_location_id"),
  scopeBatchId: uuid("scope_batch_id"),
  scopeSessionId: uuid("scope_session_id"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
