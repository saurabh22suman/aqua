import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { features } from "./platform";

// Phase 1.8 — per-tenant feature override. See architecture §7.1
// (resolution order: plan_features overridden by tenant_features)
// and §7.2 (schema spec, transcribed verbatim in the migration
// comment). One row per (tenant, feature); INSERT/UPDATE/DELETE via
// the platform_admin_all RLS policy added in migration
// 20260902210100_tenant_features.

export const tenantFeatures = pgTable(
  "tenant_features",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    featureKey: text("feature_key")
      .notNull()
      .references(() => features.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
    config: jsonb("config").notNull().default({}),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.featureKey] }),
    index("tenant_features_feature_key_idx").on(t.featureKey),
    index("tenant_features_expires_at_idx")
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
);

export type TenantFeature = typeof tenantFeatures.$inferSelect;
export type NewTenantFeature = typeof tenantFeatures.$inferInsert;

// Drizzle's sql template tag is used in the partial-index clause above;
// import directly here to keep that clause readable.
import { sql } from "drizzle-orm";
