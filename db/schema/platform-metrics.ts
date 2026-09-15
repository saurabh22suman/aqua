import { date, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

// PR3 (ops console improvements) — one row per day, written by the
// platform.metrics-snapshot job (lib/jobs/platform-metrics-snapshot-job.ts).
// Exists so the Overview KPI cards can show a real period-over-period
// delta instead of a fabricated one — see the migration comment for
// why this needed a new table rather than being computed live.
export const platformMetricsDaily = pgTable("platform_metrics_daily", {
  onDate: date("on_date").primaryKey(),
  activeTenants: integer("active_tenants").notNull(),
  trialTenants: integer("trial_tenants").notNull(),
  atRiskTenants: integer("at_risk_tenants").notNull(),
  openOpsTasks: integer("open_ops_tasks").notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlatformMetricsDaily = typeof platformMetricsDaily.$inferSelect;
