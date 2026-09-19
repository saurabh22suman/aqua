import { sql } from "drizzle-orm";
import {
  check,
  date,
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
import { v7 as uuidv7 } from "uuid";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";
import { staff } from "./staff";
import type { StaffId, TenantId } from "@/lib/ids";

// V-23 — shift templates and the weekly roster (architecture.md §8.9).
// Created in migration 20260919222556_v23_shifts; this is the typed
// access layer lib/services/shifts.ts consumes.
//
// `daysOfWeek` is 0 = Sunday .. 6 = Saturday, matching lib/time/tz.ts
// weekdayOf() so the roster builder never translates between two
// numbering schemes.
//
// `publishedAt` is the draft/published gate: staff see only shifts
// whose week has been published. The publish action stamps it; the
// staff-facing read filters on it.

export const shiftTemplates = pgTable(
  "shift_templates",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    daysOfWeek: integer("days_of_week")
      .array()
      .notNull()
      .default(sql`'{}'::int[]`),
    ...auditColumns,
  },
  (t) => [
    unique("shift_templates_id_tenant_key").on(t.id, t.tenantId),
    check("shift_templates_time_check", sql`${t.endTime} > ${t.startTime}`),
    foreignKey({
      name: "shift_templates_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    index("shift_templates_tenant_location_idx").on(t.tenantId, t.locationId),
  ],
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    staffId: uuid("staff_id").notNull().$type<StaffId>(),
    locationId: uuid("location_id").notNull(),
    templateId: uuid("template_id"),
    shiftDate: date("shift_date").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    // rostered | worked | absent | leave
    status: text("status").notNull().default("rostered"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...auditColumns,
  },
  (t) => [
    unique("shifts_id_tenant_key").on(t.id, t.tenantId),
    unique("shifts_staff_slot_key").on(
      t.tenantId,
      t.staffId,
      t.shiftDate,
      t.startAt,
    ),
    check("shifts_time_check", sql`${t.endAt} > ${t.startAt}`),
    check(
      "shifts_status_check",
      sql`${t.status} in ('rostered', 'worked', 'absent', 'leave')`,
    ),
    foreignKey({
      name: "shifts_staff_tenant_fkey",
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "shifts_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    foreignKey({
      name: "shifts_template_tenant_fkey",
      columns: [t.templateId, t.tenantId],
      foreignColumns: [shiftTemplates.id, shiftTemplates.tenantId],
    }),
    index("shifts_tenant_date_staff_idx").on(
      t.tenantId,
      t.shiftDate,
      t.staffId,
    ),
    index("shifts_tenant_staff_date_idx").on(
      t.tenantId,
      t.staffId,
      t.shiftDate,
    ),
  ],
);

export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type NewShiftTemplate = typeof shiftTemplates.$inferInsert;
export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;
