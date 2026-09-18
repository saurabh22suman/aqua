import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  boolean,
  check,
  foreignKey,
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
import { locations } from "./locations";
import { facilities } from "./preset-engine";
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
    locationId: uuid("location_id").notNull(),
    activityId: uuid("activity_id"),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    durationDays: integer("duration_days"),
    sessions: integer("sessions"),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    sourceShapeId: uuid("source_shape_id"),
    isActive: boolean("is_active").notNull().default(true),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    check(
      "membership_plans_kind_check",
      sql`${t.kind} in ('duration', 'sessions', 'one_time', 'term', 'per_session', 'drop_in')`,
    ),
    check(
      "membership_plans_kind_payload_check",
      sql`(${t.kind} in ('duration', 'term') and ${t.durationDays} is not null and ${t.durationDays} > 0 and ${t.sessions} is null) or (${t.kind} = 'sessions' and ${t.sessions} is not null and ${t.sessions} > 0 and ${t.durationDays} is null) or (${t.kind} in ('one_time', 'per_session', 'drop_in') and ${t.durationDays} is null and ${t.sessions} is null)`,
    ),
    check("membership_plans_amount_check", sql`${t.amountPaise} > 0`),
    check(
      "membership_plans_name_check",
      sql`char_length(${t.name}) between 1 and 120`,
    ),
    unique("membership_plans_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("membership_plans_shape_live_uidx")
      .on(
        t.tenantId,
        t.locationId,
        sql`coalesce(activity_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.sourceShapeId,
      )
      .where(sql`deleted_at is null and source_shape_id is not null`),
    index("membership_plans_tenant_location_live_idx")
      .on(t.tenantId, t.locationId, t.activityId)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "membership_plans_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "membership_plans_activity_tenant_fkey",
      columns: [t.activityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }),
    index("membership_plans_tenant_live_idx")
      .on(t.tenantId, t.isActive, t.name)
      .where(sql`deleted_at is null`),
  ],
);

export type MembershipPlan = typeof membershipPlans.$inferSelect;
export type NewMembershipPlan = typeof membershipPlans.$inferInsert;
export type MembershipPlanKind =
  | "duration"
  | "term"
  | "sessions"
  | "one_time"
  | "per_session"
  | "drop_in";

// The kinds sold through subscriptions (C-30); the rest are billed
// through invoices (C-32). One exported answer so the service and the
// UI never disagree about which picker a plan belongs in.
export const SUBSCRIPTION_PLAN_KINDS: ReadonlySet<MembershipPlanKind> = new Set([
  "duration",
  "term",
  "sessions",
]);

export function isSubscriptionPlanKind(kind: string): boolean {
  return SUBSCRIPTION_PLAN_KINDS.has(kind as MembershipPlanKind);
}
