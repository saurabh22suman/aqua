import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// M-01 — the platform activity-type catalogue. RLS-exempt (a platform
// table in db/allowlist.ts) and seeded by migration
// 20260918120000_m01_activity_types.sql + db/seed-platform.ts.
// Capabilities gate UI, never data integrity: nothing joins on this
// table to decide what data may exist.

export const activityTypes = pgTable("activity_types", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  capabilities: jsonb("capabilities").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ActivityType = typeof activityTypes.$inferSelect;
export type NewActivityType = typeof activityTypes.$inferInsert;
