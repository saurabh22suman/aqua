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
  // F08 (composed, rev 3) — the durable claim. "sending" means a
  // dispatcher claimed the row; "unknown" means the outcome was never
  // recorded, so the message may or may not have been delivered. See the
  // migration db/migrations/20261030062319_whatsapp_outbox_claim_state.sql.
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  // The per-claim FENCE TOKEN. The attempt counter is not unique per
  // claim (a resend resets it), so the finalise matches on this token.
  claimToken: uuid("claim_token"),
  // The CLASSIFIED reason. It is what the platform read shows, so the
  // raw provider text never leaves the tenant boundary.
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});
