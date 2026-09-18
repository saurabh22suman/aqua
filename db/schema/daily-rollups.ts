import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// C-47 — precomputed daily summaries, one row per tenant per day.
// Upserted by the nightly reports.rollup job for the day that just
// ended; idempotent by primary key. Money stays integer paise.
// E-06 — events.rollup (03:15, after reports.rollup) fills the
// event_counts/events_total columns on the same row, touching nothing
// else; both jobs are keyed on (tenant_id, on_date).

export const dailyRollups = pgTable(
  "daily_rollups",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    onDate: date("on_date").notNull(),
    sessionsHeld: integer("sessions_held").notNull().default(0),
    attendanceMarked: integer("attendance_marked").notNull().default(0),
    newMembers: integer("new_members").notNull().default(0),
    paymentsCount: integer("payments_count").notNull().default(0),
    collectionsPaise: bigint("collections_paise", { mode: "bigint" })
      .notNull()
      .default(0n),
    invoicesIssued: integer("invoices_issued").notNull().default(0),
    invoicesTotalPaise: bigint("invoices_total_paise", { mode: "bigint" })
      .notNull()
      .default(0n),
    // K-06 — café collections, counted separately from the membership
    // totals above. Same definition as the live daily collection
    // report: captured payments settled against invoices whose
    // source = 'cafe'; cafe_orders counts the distinct such invoices.
    cafePaise: bigint("cafe_paise", { mode: "bigint" }).notNull().default(0n),
    cafeOrders: integer("cafe_orders").notNull().default(0),
    eventCounts: jsonb("event_counts")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    eventsTotal: integer("events_total").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.onDate] }),
    check("daily_rollups_sessions_check", sql`${t.sessionsHeld} >= 0`),
    check("daily_rollups_attendance_check", sql`${t.attendanceMarked} >= 0`),
    check("daily_rollups_members_check", sql`${t.newMembers} >= 0`),
    check("daily_rollups_payments_check", sql`${t.paymentsCount} >= 0`),
    check("daily_rollups_collections_check", sql`${t.collectionsPaise} >= 0`),
    check("daily_rollups_invoices_check", sql`${t.invoicesIssued} >= 0`),
    check(
      "daily_rollups_invoices_total_check",
      sql`${t.invoicesTotalPaise} >= 0`,
    ),
    check("daily_rollups_cafe_paise_check", sql`${t.cafePaise} >= 0`),
    check("daily_rollups_cafe_orders_check", sql`${t.cafeOrders} >= 0`),
    check("daily_rollups_events_total_check", sql`${t.eventsTotal} >= 0`),
  ],
);

export type DailyRollup = typeof dailyRollups.$inferSelect;
