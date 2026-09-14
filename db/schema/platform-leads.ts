import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { platformUsers } from "./platform-users";
import type { TenantId } from "@/lib/ids";

// O-09 (docs/ops-platform-design.md §7) — sales leads: a club
// approaching the platform, not a parent approaching a club.
// Platform-scoped (no tenant_id until conversion), no RLS, listed in
// db/allowlist.ts as a platform table. Holds names and phone numbers,
// so direct imports are restricted by
// scripts/check-platform-leads-imports.ts.

export const platformLeads = pgTable(
  "platform_leads",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    businessName: text("business_name").notNull(),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    city: text("city"),
    source: text("source").notNull(),
    status: text("status").notNull().default("lead"),
    qualification: jsonb("qualification")
      .notNull()
      .default({})
      .$type<Record<string, unknown>>(),
    trialTenantId: uuid("trial_tenant_id")
      .references(() => tenants.id, { onDelete: "set null" })
      .$type<TenantId>(),
    trialStartsAt: timestamp("trial_starts_at", { withTimezone: true }),
    trialExpiresAt: timestamp("trial_expires_at", { withTimezone: true }),
    opsOwnerId: uuid("ops_owner_id").references(() => platformUsers.id, {
      onDelete: "set null",
    }),
    lostReason: text("lost_reason"),
    convertedTenantId: uuid("converted_tenant_id")
      .references(() => tenants.id, { onDelete: "set null" })
      .$type<TenantId>(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    check(
      "platform_leads_source_check",
      sql`${t.source} in ('website', 'phone', 'whatsapp', 'referral', 'other')`,
    ),
    check(
      "platform_leads_status_check",
      sql`${t.status} in ('lead', 'qualified', 'demo_booked', 'trial', 'converted', 'lapsed', 'lost')`,
    ),
    check(
      "platform_leads_lost_reason_check",
      sql`${t.status} <> 'lost' or ${t.lostReason} is not null`,
    ),
    index("platform_leads_status_idx").on(t.status, t.createdAt.desc()),
    index("platform_leads_phone_idx").on(t.phone),
  ],
);

export type PlatformLead = typeof platformLeads.$inferSelect;
export type NewPlatformLead = typeof platformLeads.$inferInsert;
