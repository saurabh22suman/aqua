import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";

// O-04 (docs/ops-platform-design.md §2–§3) — the configuration
// registry. config_keys is the platform-owned catalogue (seeded from
// db/config-definitions.ts); config_values is append-only, one live
// row per (key, scope) at a time, superseded on write.

export const configKeys = pgTable(
  "config_keys",
  {
    key: text("key").primaryKey(),
    valueSchema: jsonb("value_schema")
      .notNull()
      .$type<Record<string, unknown>>(),
    defaultValue: jsonb("default_value").notNull(),
    visibility: text("visibility").notNull(),
    risk: text("risk").notNull(),
    description: text("description").notNull(),
    ...auditColumns,
  },
  (t) => [
    check(
      "config_keys_visibility_check",
      sql`${t.visibility} in ('owner_edit', 'owner_read', 'ops_only')`,
    ),
    check(
      "config_keys_risk_check",
      sql`${t.risk} in ('safe', 'sensitive', 'dangerous')`,
    ),
  ],
);

export const configValues = pgTable(
  "config_values",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    key: text("key")
      .notNull()
      .references(() => configKeys.key),
    scopeType: text("scope_type").notNull(),
    // uuid string for plan/tenant/location; '<key>@<version>' for preset.
    scopeId: text("scope_id"),
    // Null for platform/plan/preset scope; the owning tenant otherwise.
    tenantId: uuid("tenant_id").references(() => tenants.id, {
      onDelete: "cascade",
    }),
    value: jsonb("value").notNull(),
    setBy: uuid("set_by"),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "config_values_scope_type_check",
      sql`${t.scopeType} in ('platform', 'plan', 'preset', 'tenant', 'location')`,
    ),
    index("config_values_live_idx")
      .on(t.key, t.scopeType, t.scopeId)
      .where(sql`superseded_at is null`),
    uniqueIndex("config_values_live_uidx")
      .on(
        t.key,
        t.scopeType,
        sql`coalesce(scope_id, '')`,
        sql`coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`superseded_at is null`),
  ],
);

export type ConfigKey = typeof configKeys.$inferSelect;
export type ConfigValue = typeof configValues.$inferSelect;
export type NewConfigValue = typeof configValues.$inferInsert;
