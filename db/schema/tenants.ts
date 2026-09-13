import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { presets } from "./platform";
import type { TenantId, UserId } from "@/lib/ids";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7())
      .$type<TenantId>(),
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
    // Phase 2.2a — preset engine writes the ordered list of card
    // keys here. The operator home reads this to render the
    // dashboard grid (architecture §7.4). JSONB rather than a
    // separate table because the list is short, ordered, and
    // single-tenant — no analytics query touches it.
    dashboardCards: jsonb("dashboard_cards")
      .notNull()
      .default([])
      .$type<string[]>(),
    presetKey: text("preset_key"),
    presetVersion: integer("preset_version"),
    presetAppliedAt: timestamp("preset_applied_at", { withTimezone: true }),
    // Kill switch for the offline attendance write path (issue #4).
    // Per-tenant, default off — a canary is one specific tenant, not
    // every tenant on a plan. See docs/architecture.md §12.2.
    offlineSyncEnabled: boolean("offline_sync_enabled").notNull().default(false),
    // R.8's absence_alert_threshold_pct column moved into the O-04
    // configuration registry (attendance.absence_alert_threshold_pct)
    // in migration 20260914030000_config_registry.sql. Read it through
    // db/config.ts, never a tenant column.
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

// O-03 (docs/ops-platform-design.md §8) — the preset bound to a
// location (copy-on-apply). One row per location; a re-apply replaces
// it. It lives beside the tenant's own preset columns because the two
// together are the preset-binding state: the tenant row owns the
// tenant-wide content (terminology, roles, skills, plan shapes,
// templates, dashboard cards) under O-03's interim first-wins rule,
// and this row owns the location-scoped binding and is the
// per-location idempotence key.
//
// The composite FK to locations and the pair FK to presets live in
// migration 20260914020000_location_preset_binding.sql. The locations
// FK is intentionally not declared here: locations.ts already imports
// tenants.ts, and an eager back-import would make table-definition
// order depend on which module loads first (a cycle that only crashes
// on some import paths).
export const locationPresets = pgTable(
  "location_presets",
  {
    locationId: uuid("location_id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    presetKey: text("preset_key").notNull(),
    presetVersion: integer("preset_version").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    appliedBy: uuid("applied_by").$type<UserId>(),
  },
  (t) => [
    unique("location_presets_location_tenant_key").on(
      t.locationId,
      t.tenantId,
    ),
    foreignKey({
      name: "location_presets_preset_fkey",
      columns: [t.presetKey, t.presetVersion],
      foreignColumns: [presets.key, presets.version],
    }),
  ],
);

export type LocationPreset = typeof locationPresets.$inferSelect;
