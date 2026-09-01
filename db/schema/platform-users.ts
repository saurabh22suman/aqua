import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const platformUsers = pgTable(
  "platform_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    totpSecret: text("totp_secret"),
    totpEnrolled: boolean("totp_enrolled").notNull().default(false),
    backupCodes: text("backup_codes").array().notNull().default(sql`'{}'::text[]`),
    role: text("role").notNull().default("admin"),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("platform_users_role_check", sql`${t.role} in ('admin', 'viewer')`),
    check(
      "platform_users_status_check",
      sql`${t.status} in ('active', 'suspended')`,
    ),
  ],
);

export const platformSessions = pgTable(
  "platform_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    secondFactorPassed: boolean("second_factor_passed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_sessions_user_id_idx").on(t.userId),
    index("platform_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export const platformAuditLog = pgTable(
  "platform_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => platformUsers.id),
    tenantId: uuid("tenant_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    detail: jsonb("detail").notNull().default({}),
    ipAddress: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("platform_audit_log_created_at_idx").on(t.createdAt.desc()),
    index("platform_audit_log_actor_id_idx").on(t.actorId),
    index("platform_audit_log_tenant_id_idx")
      .on(t.tenantId)
      .where(sql`${t.tenantId} is not null`),
  ],
);

export type PlatformUser = typeof platformUsers.$inferSelect;
export type PlatformSession = typeof platformSessions.$inferSelect;
export type PlatformAuditLog = typeof platformAuditLog.$inferSelect;
