import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { locations } from "./locations";
import type { TenantId, UserId } from "@/lib/ids";

// C-34 — the daily cash count confirmation. system_paise is the
// snapshot of counters' cash-collected figure at confirmation time;
// variance = counted - system (negative is short).
//
// Append-only, same idiom as config_values (db/schema/config.ts,
// db/config.ts): a "closed" day inserts a live row; reopening it
// supersedes that row (status -> 'reopened', superseded_at stamped)
// rather than overwriting counted/system/variance in place, so the
// original close and any later recount both stay independently
// queryable. At most one LIVE row (superseded_at is null) per
// (tenant, location, day) -- enforced by the partial unique index
// below, replacing the old hard unique key whose onConflictDoUpdate
// used to make a recount silently clobber the prior row.

export const cashCounts = pgTable(
  "cash_counts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    onDate: date("on_date").notNull(),
    countedPaise: bigint("counted_paise", { mode: "bigint" }).notNull(),
    systemPaise: bigint("system_paise", { mode: "bigint" }).notNull(),
    variancePaise: bigint("variance_paise", { mode: "bigint" }).notNull(),
    // Doubles as the >₹500 variance reason (lib/services/reconciliation.ts
    // makes it required, via Zod, once the variance crosses the
    // threshold -- see REVIEW_THRESHOLD_PAISE there).
    note: text("note"),
    confirmedBy: uuid("confirmed_by").$type<UserId>(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Closed-state tracking (the silent-overwrite audit fix). Every
    // row is 'closed' at insert time; a reopen flips THIS row to
    // 'reopened' and stamps superseded_at -- it never becomes
    // 'closed' again. The next confirm inserts a brand-new 'closed'
    // row, which is how the prior count survives instead of being
    // overwritten.
    status: text("status").notNull().default("closed"),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    reopenedBy: uuid("reopened_by").$type<UserId>(),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    reopenReason: text("reopen_reason"),
  },
  (t) => [
    check("cash_counts_counted_check", sql`${t.countedPaise} >= 0`),
    check("cash_counts_system_check", sql`${t.systemPaise} >= 0`),
    check(
      "cash_counts_variance_check",
      sql`${t.variancePaise} = ${t.countedPaise} - ${t.systemPaise}`,
    ),
    check(
      "cash_counts_note_check",
      sql`${t.note} is null or char_length(${t.note}) between 1 and 500`,
    ),
    check(
      "cash_counts_status_check",
      sql`${t.status} in ('closed', 'reopened')`,
    ),
    check(
      "cash_counts_reopen_reason_check",
      sql`${t.reopenReason} is null or char_length(${t.reopenReason}) between 1 and 500`,
    ),
    unique("cash_counts_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("cash_counts_live_uidx")
      .on(t.tenantId, t.locationId, t.onDate)
      .where(sql`superseded_at is null`),
    index("cash_counts_tenant_date_idx").on(t.tenantId, t.onDate.desc()),
    foreignKey({
      name: "cash_counts_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type CashCount = typeof cashCounts.$inferSelect;
