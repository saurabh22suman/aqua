import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TenantId, UserId } from "@/lib/ids";
import type { ActivityActorKind, ActivitySource } from "@/lib/events/registry";

// E-05 — product/operational event stream (architecture.md §8.11).
// Separate from audit_log by design: audit is compliance (never
// deleted, joins to domain state, can hold sensitive before/after),
// events are analytics (safe to lose, rolled up and dropped by
// partition, no PII). The two join by request_id and entity_id.
//
// The applied table is RANGE PARTITIONED BY (occurred_at) with
// monthly partitions 2026-09 .. 2028-12 and NO default partition
// (out-of-horizon writers fail loudly). Drizzle has no partition
// declaration for pgTable — partitioning lives in
// db/migrations/20260918070000_e05_activity_events.sql, and this
// declaration must stay in lockstep with it.
//
// Unique key: (tenant_id, client_event_id, occurred_at). PostgreSQL
// requires every unique index on a partitioned table to include the
// partition key, so a retry MUST resend the original occurred_at for
// idempotency to hold — the migration spells this out. `id` is a
// UUIDv7 generated app-side (db/schema has no gen_random_uuid
// default; the H-02 convention scan enforces that).
//
// No `primaryKey()` here on purpose: a partitioned table cannot carry
// a primary key that omits the partition key, and §8.11's contract
// declares `id uuid not null` only. The table is append-only; the
// unique index is the identity that matters.
//
// RLS: enable + force with the standard nullif tenant policy, set in
// the migration. Grants are SELECT + INSERT only for app_user —
// activity events are never updated or deleted by the app; partition
// retention (E-06) drops whole partitions, not rows.

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").notNull(),
    tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    actorId: uuid("actor_id").$type<UserId>(),
    actorKind: text("actor_kind").$type<ActivityActorKind>(),
    sessionId: text("session_id"),
    requestId: uuid("request_id"),
    eventName: text("event_name").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    properties: jsonb("properties").notNull().default({}),
    context: jsonb("context").notNull().default({}),
    source: text("source").notNull().$type<ActivitySource>(),
    clientEventId: text("client_event_id").notNull(),
  },
  (t) => [
    // Must include occurred_at — see the partition-key note above.
    uniqueIndex("activity_events_tenant_client_occurred_uidx").on(
      t.tenantId,
      t.clientEventId,
      t.occurredAt,
    ),
    index("activity_events_tenant_occurred_idx").on(
      t.tenantId,
      t.occurredAt.desc(),
    ),
    index("activity_events_tenant_name_occurred_idx").on(
      t.tenantId,
      t.eventName,
      t.occurredAt.desc(),
    ),
  ],
);

export type ActivityEventRow = typeof activityEvents.$inferSelect;
