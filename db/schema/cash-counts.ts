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
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { locations } from "./locations";
import type { TenantId, UserId } from "@/lib/ids";

// C-34 — the daily cash count confirmation. system_paise is the
// snapshot of counters' cash-collected figure at confirmation time;
// variance = counted - system (negative is short). One row per tenant
// + location + day; a recount replaces it.

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
    note: text("note"),
    confirmedBy: uuid("confirmed_by").$type<UserId>(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
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
    unique("cash_counts_id_tenant_key").on(t.id, t.tenantId),
    unique("cash_counts_location_day_key").on(
      t.tenantId,
      t.locationId,
      t.onDate,
    ),
    index("cash_counts_tenant_date_idx").on(t.tenantId, t.onDate.desc()),
    foreignKey({
      name: "cash_counts_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type CashCount = typeof cashCounts.$inferSelect;
