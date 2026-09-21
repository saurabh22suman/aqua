import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// PR1-C8 — one row per running worker process. Platform-scoped
// infrastructure (no tenant_id), allowlisted like platform_audit_log;
// written by worker/index.ts, read by /api/health.
export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});
