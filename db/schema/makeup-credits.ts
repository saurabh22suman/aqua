import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { MemberId, TenantId, UserId } from "@/lib/ids";

// Phase R.7 — V.18 makeup_credits. The Drizzle mirror of the
// 20260904090000_makeup_credits.sql migration. The status enum
// (granted/redeemed/expired) is closed at the schema level and
// matches the SQL CHECK constraint.

export const makeupCredits = pgTable(
  "makeup_credits",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    sourceSessionId: uuid("source_session_id").notNull(),
    status: text("status").notNull().default("granted"),
    redeemedSessionId: uuid("redeemed_session_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdBy: uuid("created_by").$type<UserId>(),
    updatedBy: uuid("updated_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial index: outstanding credits by tenant (the
    // dashboard / "your member has N makeups available" query).
    index("makeup_credits_tenant_status_idx")
      .on(t.tenantId, t.status)
      .where(sql`status = 'granted'`),
    // Partial index: outstanding credits by member (the
    // member detail panel — same "you have N makeups" view
    // scoped to one member).
    index("makeup_credits_member_outstanding_idx")
      .on(t.tenantId, t.memberId)
      .where(sql`status = 'granted'`),
    // The (tenant, member, source) tuple is the natural key
    // per the SQL migration. Same shape enforced at the SQL
    // level — Drizzle's `unique` mirrors it.
    unique("makeup_credits_member_source_key").on(
      t.tenantId,
      t.memberId,
      t.sourceSessionId,
    ),
  ],
);

export type MakeupCredit = typeof makeupCredits.$inferSelect;
export type MakeupCreditStatus = "granted" | "redeemed" | "expired";
