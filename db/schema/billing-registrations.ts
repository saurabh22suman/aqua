import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { locations } from "./locations";
import type { TenantId } from "@/lib/ids";

// Immutable versions; FORCE RLS and runtime UPDATE/DELETE revocation are in SQL.
export const billingRegistrations = pgTable("billing_registrations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).$type<TenantId>(),
  legalName: text("legal_name").notNull(),
  legalAddress: jsonb("legal_address").notNull().$type<Record<string, unknown>>(),
  stateCode: text("state_code").notNull(),
  gstin: text("gstin").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("billing_registrations_id_tenant_id_key").on(t.id, t.tenantId),
  check("billing_registrations_legal_name_check", sql`btrim(${t.legalName}) <> ''`),
]);

export const locationBillingSettings = pgTable("location_billing_settings", {
  tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
  locationId: uuid("location_id").notNull(),
  stateCode: text("state_code").notNull(),
  facilityBillingEnabled: boolean("facility_billing_enabled").notNull().default(false),
  mode: text("mode").notNull().$type<"inherit" | "registered_override" | "unregistered_override">(),
  registrationId: uuid("registration_id"),
  unregisteredLegalName: text("unregistered_legal_name"),
  unregisteredLegalAddress: jsonb("unregistered_legal_address").$type<Record<string, unknown>>(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.locationId] }),
  foreignKey({ columns: [t.locationId, t.tenantId], foreignColumns: [locations.id, locations.tenantId] }).onDelete("cascade"),
  foreignKey({ columns: [t.registrationId, t.tenantId], foreignColumns: [billingRegistrations.id, billingRegistrations.tenantId] }),
]);
