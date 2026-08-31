import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { check, foreignKey, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { batches } from "./programs";
import type { TenantId, MemberId, UserId } from "@/lib/ids";

export const enquiries = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    source: text("source").notNull(),
    stage: text("stage").notNull().default("new"),
    // Bare user id, no FK -- see migration 0019's comment.
    assignedToUserId: uuid("assigned_to_user_id").$type<UserId>(),
    memberId: uuid("member_id").$type<MemberId>(),
    trialBatchId: uuid("trial_batch_id"),
    notes: text("notes"),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("enquiries_id_tenant_key").on(t.id, t.tenantId),
    index("enquiries_tenant_live_idx").on(t.tenantId).where(sql`deleted_at is null`),
    index("enquiries_tenant_stage_live_idx")
      .on(t.tenantId, t.stage)
      .where(sql`deleted_at is null`),
    check(
      "enquiries_source_check",
      sql`${t.source} in ('walk-in', 'phone', 'referral', 'online', 'other')`,
    ),
    check(
      "enquiries_stage_check",
      sql`${t.stage} in ('new', 'contacted', 'trial_scheduled', 'trial_completed', 'converted', 'lost')`,
    ),
    foreignKey({
      name: "enquiries_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "enquiries_trial_batch_tenant_fkey",
      columns: [t.trialBatchId, t.tenantId],
      foreignColumns: [batches.id, batches.tenantId],
    }),
  ],
);

export const enquiryFollowUps = pgTable(
  "enquiry_follow_ups",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    enquiryId: uuid("enquiry_id").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    doneAt: timestamp("done_at", { withTimezone: true }),
    assignedToUserId: uuid("assigned_to_user_id").$type<UserId>(),
    ...auditColumns,
  },
  (t) => [
    index("enquiry_follow_ups_tenant_due_idx")
      .on(t.tenantId, t.dueAt)
      .where(sql`done_at is null`),
    foreignKey({
      name: "enquiry_follow_ups_enquiry_tenant_fkey",
      columns: [t.enquiryId, t.tenantId],
      foreignColumns: [enquiries.id, enquiries.tenantId],
    }),
  ],
);

export type Enquiry = typeof enquiries.$inferSelect;
export type EnquiryFollowUp = typeof enquiryFollowUps.$inferSelect;
export type EnquirySource = "walk-in" | "phone" | "referral" | "online" | "other";
export type EnquiryStage = "new" | "contacted" | "trial_scheduled" | "trial_completed" | "converted" | "lost";
