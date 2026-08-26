import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { presets } from "./platform";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("trial"),
    planId: uuid("plan_id"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    currency: text("currency").notNull().default("INR"),
    gstin: text("gstin"),
    branding: jsonb("branding")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    terminology: jsonb("terminology")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    presetKey: text("preset_key"),
    presetVersion: integer("preset_version"),
    presetAppliedAt: timestamp("preset_applied_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    check(
      "tenants_status_check",
      sql`${t.status} in ('trial', 'active', 'suspended', 'churned')`,
    ),
    foreignKey({
      name: "tenants_preset_fkey",
      columns: [t.presetKey, t.presetVersion],
      foreignColumns: [presets.key, presets.version],
    }),
    check(
      "tenants_preset_pair_check",
      sql`(${t.presetKey} is null) = (${t.presetVersion} is null)`,
    ),
  ],
);
