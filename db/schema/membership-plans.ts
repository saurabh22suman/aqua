import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// C-29 — the priced plan a tenant sells. Preset `plan_shapes` are the
// templates (amount nullable); activating one creates a row here, and
// C-30's subscriptions reference it.

export const membershipPlans = pgTable(
  "membership_plans",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    durationDays: integer("duration_days"),
    sessions: integer("sessions"),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(1800),
    sourceShapeId: uuid("source_shape_id"),
    isActive: boolean("is_active").notNull().default(true),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "membership_plans_kind_check",
      sql`${t.kind} in ('duration', 'sessions', 'one_time')`,
    ),
    check(
      "membership_plans_kind_payload_check",
      sql`(${t.kind} = 'duration' and ${t.durationDays} is not null and ${t.durationDays} > 0 and ${t.sessions} is null) or (${t.kind} = 'sessions' and ${t.sessions} is not null and ${t.sessions} > 0 and ${t.durationDays} is null) or (${t.kind} = 'one_time' and ${t.durationDays} is null and ${t.sessions} is null)`,
    ),
    check("membership_plans_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "membership_plans_tax_rate_check",
      sql`${t.taxRateBp} between 0 and 10000`,
    ),
    check(
      "membership_plans_name_check",
      sql`char_length(${t.name}) between 1 and 120`,
    ),
    unique("membership_plans_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("membership_plans_shape_live_uidx")
      .on(t.tenantId, t.sourceShapeId)
      .where(sql`deleted_at is null and source_shape_id is not null`),
    index("membership_plans_tenant_live_idx")
      .on(t.tenantId, t.isActive, t.name)
      .where(sql`deleted_at is null`),
  ],
);

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type NewMembershipPlan = typeof membershipPlans.$inferInsert;
export type MembershipPlanKind = "duration" | "sessions" | "one_time";
