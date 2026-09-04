import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import type { TenantId, UserId } from "@/lib/ids";

// Phase R.3 — tenant_holidays. Drizzle mirror of the
// 20260904100000_tenant_holidays.sql migration. Indexes in
// SQL aren't expressible in Drizzle for the
// extract(month|day) partial index; the migration is the
// source of truth for that and the schema is the source of
// truth for the row shape.

export const tenantHolidays = pgTable(
  "tenant_holidays",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    holidayDate: date("holiday_date").notNull(),
    recurringYearly: boolean("recurring_yearly").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").$type<UserId>(),
    updatedBy: uuid("updated_by").$type<UserId>(),
  },
  (t) => [
    index("tenant_holidays_tenant_date_idx").on(t.tenantId, t.holidayDate),
  ],
);

export type TenantHoliday = typeof tenantHolidays.$inferSelect;
