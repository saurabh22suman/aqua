import { bigserial, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import type { TenantId, UserId } from "@/lib/ids";

// Tenant-side audit trail (architecture.md §8.10). First caller:
// parent-link issuance (lib/actions/parent-link.ts).
//
// bigserial — not uuid — because this table grows fastest and is
// queried least (architecture.md §8.1 carve-out for time-partitioned,
// append-only tables never targeted by foreign keys). Partition by
// month later — same carve-out's deferral note.
//
// The audit row's `after` JSONB carries the durable detail of the
// action (e.g. parent-link issuance: member_id + staff_id +
// issuedAt + expiresAt + scope, never the token itself). Schema is
// the source of truth for which actions exist; the row's payload
// is the source of truth for what happened.
//
// RLS: tenant_isolation + FORCE row level security (set in the
// migration), same nullif shape as every other tenant table.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id)
      .$type<UserId>(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_tenant_id_created_at_idx").on(t.tenantId, t.createdAt.desc()),
    index("audit_log_tenant_id_entity_idx").on(t.tenantId, t.entityType, t.entityId),
  ],
);

export type AuditLog = typeof auditLog.$inferSelect;
