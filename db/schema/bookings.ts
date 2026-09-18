import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";
import { facilities, facilitySubUnits } from "./preset-engine";
import { members } from "./people";
import { invoices } from "./invoices";
import type { MemberId, TenantId } from "@/lib/ids";

// V-02/V-03 — facilities and bookings (architecture.md §8.7).
// The tables were created in migrations 20260918140000_v02_bookings
// and 20260918141000_v03_booking_pricing; this is the typed access
// layer the booking services consume.
//
// The overlap guarantee is the database's `bookings_no_overlap_excl`
// EXCLUDE constraint (btree_gist), deliberately NOT modelled here:
// the insert either succeeds or raises SQLSTATE 23P01, and
// lib/services/bookings.ts maps that to the friendly refusal. A
// check-then-insert in this layer would be the exact failure the
// constraint exists to prevent.

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    facilityId: uuid("facility_id").notNull(),
    subUnitId: uuid("sub_unit_id"),
    memberId: uuid("member_id").$type<MemberId>(),
    walkInName: text("walk_in_name"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // held | confirmed | cancelled | completed
    status: text("status").notNull().default("confirmed"),
    // GST-inclusive paise: the amount the customer pays.
    pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
    notes: text("notes"),
    invoiceId: uuid("invoice_id"),
    ...auditColumns,
  },
  (t) => [
    unique("bookings_id_tenant_key").on(t.id, t.tenantId),
    check("bookings_time_check", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "bookings_status_check",
      sql`${t.status} in ('held', 'confirmed', 'cancelled', 'completed')`,
    ),
    check("bookings_price_check", sql`${t.pricePaise} >= 0`),
    check(
      "bookings_person_check",
      sql`(${t.memberId} is not null) <> (${t.walkInName} is not null)`,
    ),
    foreignKey({
      name: "bookings_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "bookings_facility_tenant_fkey",
      columns: [t.facilityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "bookings_sub_unit_tenant_fkey",
      columns: [t.subUnitId, t.tenantId],
      foreignColumns: [facilitySubUnits.id, facilitySubUnits.tenantId],
    }),
    foreignKey({
      name: "bookings_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "bookings_invoice_tenant_fkey",
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }),
    index("bookings_tenant_starts_idx").on(t.tenantId, t.startsAt),
    index("bookings_tenant_location_starts_idx").on(
      t.tenantId,
      t.locationId,
      t.startsAt,
    ),
    index("bookings_tenant_facility_starts_idx").on(
      t.tenantId,
      t.facilityId,
      t.startsAt,
    ),
  ],
);

// V-03 — the price-rule catalogue. NULL facility_id = all facilities;
// empty days_of_week = every day; NULL start/end time = all day.
// Resolution (highest priority, then facility-specific, then
// narrowest window) lives in lib/services/booking-pricing.ts.
export const bookingPriceRules = pgTable(
  "booking_price_rules",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    facilityId: uuid("facility_id"),
    label: text("label").notNull(),
    daysOfWeek: integer("days_of_week")
      .array()
      .notNull()
      .default(sql`'{}'::int[]`),
    startTime: time("start_time"),
    endTime: time("end_time"),
    pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
    priority: integer("priority").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    ...auditColumns,
  },
  (t) => [
    unique("booking_price_rules_id_tenant_key").on(t.id, t.tenantId),
    check("booking_price_rules_price_check", sql`${t.pricePaise} >= 0`),
    foreignKey({
      name: "booking_price_rules_facility_tenant_fkey",
      columns: [t.facilityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }),
    index("booking_price_rules_tenant_active_idx").on(
      t.tenantId,
      t.isActive,
      t.facilityId,
    ),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type BookingPriceRule = typeof bookingPriceRules.$inferSelect;
export type NewBookingPriceRule = typeof bookingPriceRules.$inferInsert;
