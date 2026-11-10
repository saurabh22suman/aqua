import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { tenants } from "./tenants";
import { locations } from "./locations";
import { bookings } from "./bookings";
import type { TenantId, UserId } from "@/lib/ids";

// The paid-booking entry lane's recorded admission — the typed mirror of
// db/migrations/20261106120000_booking_check_ins.sql.
//
// The mirror and the migration must agree:
//   * the migration declares `id uuid primary key`; this mirror declares
//     .primaryKey();
//   * NEITHER side has a database default. The uuidv7 is generated app-side
//     by $defaultFn, the H-02 convention (gen_random_uuid() would be a v4).
//     Every insert path goes through this mirror or supplies a uuidv7;
//   * the index direction matches the migration's
//     (tenant_id, checked_in_at desc).
//
// The append-only rule and the restrict foreign keys are enforced in the
// migration. Drizzle cannot express a trigger or an ON DELETE RESTRICT
// policy in a way this file could enforce at runtime, so they are declared
// in the mirror's comments and in each foreignKey's .onDelete("restrict").

export const bookingCheckIns = pgTable(
  "booking_check_ins",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" })
      .$type<TenantId>(),
    bookingId: uuid("booking_id").notNull(),
    locationId: uuid("location_id").notNull(),
    method: text("method").notNull().default("qr"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkedInBy: uuid("checked_in_by").$type<UserId>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("booking_check_ins_id_tenant_key").on(t.id, t.tenantId),
    unique("booking_check_ins_tenant_booking_key").on(
      t.tenantId,
      t.bookingId,
    ),
    check("booking_check_ins_method_check", sql`${t.method} in ('qr')`),
    foreignKey({
      name: "booking_check_ins_booking_tenant_fkey",
      columns: [t.bookingId, t.tenantId],
      foreignColumns: [bookings.id, bookings.tenantId],
    }).onDelete("restrict"),
    foreignKey({
      name: "booking_check_ins_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }).onDelete("restrict"),
    index("booking_check_ins_tenant_checked_idx").on(
      t.tenantId,
      t.checkedInAt.desc(),
    ),
  ],
);

export type BookingCheckIn = typeof bookingCheckIns.$inferSelect;
export type NewBookingCheckIn = typeof bookingCheckIns.$inferInsert;
