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
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { presets } from "./platform";
import type { TenantId } from "@/lib/ids";

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
