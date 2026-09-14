import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { membershipPlans } from "./membership-plans";
import { locations } from "./locations";
import { facilities } from "./preset-engine";
import type { TenantId, MemberId } from "@/lib/ids";

// C-30 — subscriptions: a member's plan over time. Pause records the
// window; resume extends ends_on by the elapsed paused days (inclusive
// end date semantics).

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    planId: uuid("plan_id").notNull(),
    locationId: uuid("location_id").notNull(),
    activityId: uuid("activity_id"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    status: text("status").notNull().default("active"),
    pausedFrom: date("paused_from"),
    pausedUntil: date("paused_until"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    mandateId: text("mandate_id"),
    ...auditColumns,
  },
  (t) => [
    check(
      "subscriptions_status_check",
      sql`${t.status} in ('active', 'paused', 'expired', 'cancelled')`,
    ),
    check("subscriptions_dates_check", sql`${t.endsOn} >= ${t.startsOn}`),
    check(
      "subscriptions_paused_from_check",
      sql`${t.status} <> 'paused' or ${t.pausedFrom} is not null`,
    ),
    check(
      "subscriptions_paused_range_check",
      sql`${t.pausedUntil} is null or (${t.pausedFrom} is not null and ${t.pausedUntil} >= ${t.pausedFrom})`,
    ),
    unique("subscriptions_id_tenant_key").on(t.id, t.tenantId),
    index("subscriptions_tenant_ends_idx")
      .on(t.tenantId, t.endsOn)
      .where(sql`status = 'active'`),
    index("subscriptions_tenant_member_idx").on(t.tenantId, t.memberId),
    foreignKey({
      name: "subscriptions_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "subscriptions_plan_tenant_fkey",
      columns: [t.planId, t.tenantId],
      foreignColumns: [membershipPlans.id, membershipPlans.tenantId],
    }),
    index("subscriptions_tenant_location_idx")
      .on(t.tenantId, t.locationId)
      .where(sql`status = 'active'`),
    foreignKey({
      name: "subscriptions_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "subscriptions_activity_tenant_fkey",
      columns: [t.activityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type SubscriptionStatus = "active" | "paused" | "expired" | "cancelled";
