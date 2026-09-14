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

// O-07 — an owner's request to change an owner_read key. Reviewed by
// ops; see db/config-requests.ts.
export const configChangeRequests = pgTable(
  "config_change_requests",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key")
      .notNull()
      .references(() => configKeys.key),
    requestedValue: text("requested_value").notNull(),
    note: text("note"),
    status: text("status").notNull().default("requested"),
    requestedBy: uuid("requested_by"),
    resolvedBy: uuid("resolved_by"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "config_change_requests_status_check",
      sql`${t.status} in ('requested', 'resolved', 'declined')`,
    ),
    index("config_change_requests_tenant_idx").on(
      t.tenantId,
      t.status,
      t.createdAt.desc(),
    ),
  ],
);

export type ConfigKey = typeof configKeys.$inferSelect;
export type ConfigValue = typeof configValues.$inferSelect;
export type NewConfigValue = typeof configValues.$inferInsert;
export type ConfigChangeRequest = typeof configChangeRequests.$inferSelect;
