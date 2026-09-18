import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import type { TenantId } from "@/lib/ids";

// M-04/M-05 — the module registry. `modules` is a platform table
// (db/allowlist.ts, RLS-exempt, select-only for the app role);
// `tenant_modules` is tenant data with the converged RLS posture.

export const modules = pgTable("modules", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("ga"),
  capabilities: jsonb("capabilities").notNull().default({}),
  presetKeys: text("preset_keys").array().notNull().default(sql`'{}'`),
  configKeys: text("config_keys").array().notNull().default(sql`'{}'`),
  featureKeys: text("feature_keys").array().notNull().default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tenantModules = pgTable(
  "tenant_modules",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    moduleKey: text("module_key").notNull(),
    version: integer("version").notNull(),
    enabledAt: timestamp("enabled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    enabledBy: uuid("enabled_by").references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.moduleKey] })],
);

export type Module = typeof modules.$inferSelect;
export type NewModule = typeof modules.$inferInsert;
export type TenantModule = typeof tenantModules.$inferSelect;
export type NewTenantModule = typeof tenantModules.$inferInsert;
