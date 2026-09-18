import {
  bigserial,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import type { TenantId, UserId } from "@/lib/ids";

// Tenant-side audit trail (architecture.md §8.10). First caller:
// parent-link issuance (lib/actions/parent-link.ts).
//
// bigserial — not uuid — because this table grows fastest and is
// queried least (architecture.md §8.1 carve-out for time-partitioned,
// append-only tables never targeted by foreign keys). The applied
// table is RANGE PARTITIONED BY (created_at) with monthly partitions,
// static horizon through 2028-12, no default partition — H-03,
// db/migrations/20260918090000_h03_audit_log_partitioning.sql.
// The primary key is composite (id, created_at) because PostgreSQL
// requires every unique index on a partitioned table to include the
// partition key; partitioning lives in the migration, and this
// declaration must stay in lockstep with it.
//
// tenant_id intentionally has no foreign key here: the applied
// migration (20260907000000_audit_log.sql) never created one, and the
// table is a compliance record that must survive a tenant delete. The
// Drizzle declaration used to disagree with the database; E-01/H-02
// aligned it to the database, not the other way around.
//
// actor_type defaults to 'user' and actor_id is nullable as of E-01:
// a system job has no user actor, and the old NOT NULL actor_id is
// exactly why subscriptions.expire and renewal invoices were
// unauditable (F-14/F-15).
//
// The audit row's `after` JSONB carries the durable detail of the
// action (e.g. parent-link issuance: member_id + staff_id +
// issuedAt + expiresAt + scope, never the token itself). Schema is
// the source of truth for which actions exist; the row's payload
// is the source of truth for what happened.
//
// RLS: tenant_isolation + FORCE row level security (set in the
// migration), same nullif shape as every other tenant table.

export const AUDIT_ACTOR_TYPES = [
  "user",
  "staff",
  "system",
  "job",
  "platform",
  "support",
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SOURCES = ["web", "job", "ops", "api"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }),
    tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
    actorType: text("actor_type").notNull().default("user").$type<AuditActorType>(),
    actorId: uuid("actor_id")
      .references(() => users.id)
      .$type<UserId>(),
    impersonatorId: uuid("impersonator_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    changedFields: text("changed_fields").array(),
    ip: inet("ip_address"),
    source: text("source").notNull().default("web").$type<AuditSource>(),
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Must include created_at — the partition key (see the note above).
    primaryKey({ columns: [t.id, t.createdAt] }),
    index("audit_log_tenant_id_created_at_idx").on(t.tenantId, t.createdAt.desc()),
    index("audit_log_tenant_id_entity_idx").on(t.tenantId, t.entityType, t.entityId),
    index("audit_log_tenant_action_created_idx").on(
      t.tenantId,
      t.action,
      t.createdAt.desc(),
    ),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
