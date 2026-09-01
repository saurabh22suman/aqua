import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { persons } from "./people";
import type { TenantId, PersonId, UserId } from "@/lib/ids";

export const guardianships = pgTable(
  "guardianships",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    minorId: uuid("minor_id").notNull().$type<PersonId>(),
    guardianId: uuid("guardian_id").notNull().$type<PersonId>(),
    relationship: text("relationship").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("guardianships_tenant_minor_guardian_key").on(
      t.tenantId,
      t.minorId,
      t.guardianId,
    ),
    index("guardianships_tenant_minor_live_idx")
      .on(t.tenantId, t.minorId)
      .where(sql`deleted_at is null`),
    foreignKey({
      name: "guardianships_minor_tenant_fkey",
      columns: [t.minorId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
    foreignKey({
      name: "guardianships_guardian_tenant_fkey",
      columns: [t.guardianId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
  ],
);

// Platform-level, not tenant-scoped -- OUR standard consent notice shown
// to every guardian/adult member across every tenant, not a per-tenant
// document (C-05a's operator DPA is the separate, tenant-specific one).
export const policyVersions = pgTable("policy_versions", {
  version: text("version").primaryKey(),
  content: text("content").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    personId: uuid("person_id").notNull().$type<PersonId>(),
    purpose: text("purpose").notNull(),
    grantedBy: uuid("granted_by").notNull().$type<PersonId>(),
    // Staff who facilitated/witnessed capture, distinct from who
    // consented. Genuinely a UserId (the logged-in staff member's own
    // identity), not a StaffId -- witnessing consent isn't a staff-role
    // action, it's "whoever was signed in." The comment this replaced
    // ("staff/C-04 doesn't exist yet") was stale: C-04 shipped, this
    // column's semantics didn't change, and branding confirms that --
    // no compile error here, on purpose.
    witnessedByUserId: uuid("witnessed_by_user_id").$type<UserId>(),
    policyVersion: text("policy_version")
      .notNull()
      .references(() => policyVersions.version),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    // Self-contained snapshot at grant time (channel, ip, userAgent,
    // granterName, granterRelationship) -- not just foreign keys that
    // could later be edited or erased (V-47). The whole point of this
    // record is that it can be shown to someone; it must still say
    // something after the person it references may no longer exist
    // as a live, readable row.
    evidence: jsonb("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "consents_purpose_check",
      sql`${t.purpose} in ('processing', 'photography', 'communications')`,
    ),
    // At most one ACTIVE grant per (tenant, person, purpose). A
    // re-grant after withdrawal is a new row; the old one stays
    // withdrawn forever (db/migrations/0015's immutability trigger).
    uniqueIndex("consents_one_active_grant")
      .on(t.tenantId, t.personId, t.purpose)
      .where(sql`withdrawn_at is null`),
    index("consents_tenant_person_idx").on(t.tenantId, t.personId),
    foreignKey({
      name: "consents_person_tenant_fkey",
      columns: [t.personId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
    foreignKey({
      name: "consents_granted_by_tenant_fkey",
      columns: [t.grantedBy, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
  ],
);

export type Guardianship = typeof guardianships.$inferSelect;
export type PolicyVersion = typeof policyVersions.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type ConsentPurpose = "processing" | "photography" | "communications";
