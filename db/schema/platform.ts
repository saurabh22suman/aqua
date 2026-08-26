import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    key: text("key").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    pricePaise: bigint("price_paise", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    unique("plans_key_unique").on(t.key),
    uniqueIndex("plans_single_default")
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    check(
      "plans_status_check",
      sql`${t.status} in ('active', 'deprecated')`,
    ),
  ],
);

export const features = pgTable(
  "features",
  {
    key: text("key").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    status: text("status").notNull().default("ga"),
  },
  (t) => [
    check(
      "features_status_check",
      sql`${t.status} in ('ga', 'beta', 'internal')`,
    ),
  ],
);

export const planFeatures = pgTable(
  "plan_features",
  {
    planId: uuid("plan_id").notNull(),
    featureKey: text("feature_key").notNull(),
    limits: jsonb("limits").notNull().default({}),
  },
  (t) => [
    primaryKey({ name: "plan_features_pkey", columns: [t.planId, t.featureKey] }),
    foreignKey({
      name: "plan_features_plan_id_fkey",
      columns: [t.planId],
      foreignColumns: [plans.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "plan_features_feature_key_fkey",
      columns: [t.featureKey],
      foreignColumns: [features.key],
    }),
  ],
);

export const presets = pgTable(
  "presets",
  {
    key: text("key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    definition: jsonb("definition").notNull(),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    primaryKey({ name: "presets_pkey", columns: [t.key, t.version] }),
    check(
      "presets_status_check",
      sql`${t.status} in ('active', 'deprecated')`,
    ),
  ],
);

export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  description: text("description").notNull(),
});

export type Plan = typeof plans.$inferSelect;
export type Feature = typeof features.$inferSelect;
export type PlanFeature = typeof planFeatures.$inferSelect;
export type Preset = typeof presets.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
