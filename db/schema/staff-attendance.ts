import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { staff } from "./staff";
import { shifts } from "./shifts";
import type { StaffId, TenantId } from "@/lib/ids";

// V-24 — staff attendance (architecture.md §8.9). Created in migration
// 20260919223554_v24_staff_attendance; this is the typed access layer
// lib/services/staff-attendance.ts consumes.
//
// One row per staff member per work_date. `markedBy` is set if and
// only if `method` is manual (database CHECK); the service also
// requires a note on manual corrections, so "who corrected this and
// why" is never lost.

export const staffAttendance = pgTable(
  "staff_attendance",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    staffId: uuid("staff_id").notNull().$type<StaffId>(),
    shiftId: uuid("shift_id"),
    workDate: date("work_date").notNull(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    // self_app | self_qr | manual
    method: text("method").notNull(),
    markedBy: uuid("marked_by").$type<StaffId>(),
    lateMinutes: integer("late_minutes").notNull().default(0),
    // present | absent | half_day | leave | holiday
    status: text("status").notNull(),
    note: text("note"),
    clientId: text("client_id").notNull(),
    ...auditColumns,
  },
  (t) => [
    unique("staff_attendance_id_tenant_key").on(t.id, t.tenantId),
    unique("staff_attendance_staff_day_key").on(
      t.tenantId,
      t.staffId,
      t.workDate,
    ),
    check(
      "staff_attendance_method_check",
      sql`${t.method} in ('self_app', 'self_qr', 'manual')`,
    ),
    check(
      "staff_attendance_status_check",
      sql`${t.status} in ('present', 'absent', 'half_day', 'leave', 'holiday')`,
    ),
    check("staff_attendance_late_check", sql`${t.lateMinutes} >= 0`),
    check(
      "staff_attendance_checkout_check",
      sql`${t.checkedOutAt} is null or ${t.checkedInAt} is not null`,
    ),
    check(
      "staff_attendance_marked_by_check",
      sql`(${t.method} = 'manual') = (${t.markedBy} is not null)`,
    ),
    foreignKey({
      name: "staff_attendance_staff_tenant_fkey",
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "staff_attendance_marked_by_tenant_fkey",
      columns: [t.markedBy, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "staff_attendance_shift_tenant_fkey",
      columns: [t.shiftId, t.tenantId],
      foreignColumns: [shifts.id, shifts.tenantId],
    }),
    index("staff_attendance_tenant_date_staff_idx").on(
      t.tenantId,
      t.workDate,
      t.staffId,
    ),
  ],
);

export type StaffAttendance = typeof staffAttendance.$inferSelect;
export type NewStaffAttendance = typeof staffAttendance.$inferInsert;
export type StaffAttendanceMethod = "self_app" | "self_qr" | "manual";
export type StaffAttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "leave"
  | "holiday";
