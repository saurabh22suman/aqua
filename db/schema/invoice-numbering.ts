import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// C-31 — the gapless invoice counter, one row per tenant per financial
// year. Allocation happens under `select … for update` inside the
// invoice transaction; never a Postgres sequence (rollbacks would leave
// gaps).
export const invoiceNumberCounters = pgTable(
  "invoice_number_counters",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    financialYear: text("financial_year").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.financialYear] }),
    check(
      "invoice_number_counters_fy_check",
      sql`${t.financialYear} ~ '^\\d{4}-\\d{2}$'`,
    ),
    check("invoice_number_counters_next_check", sql`${t.nextNumber} > 0`),
  ],
);

export type InvoiceNumberCounter = typeof invoiceNumberCounters.$inferSelect;
