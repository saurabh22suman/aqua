import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
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
import type { StaffId, TenantId } from "@/lib/ids";

// V-26/V-27 — leave types and requests (architecture.md §8.9).
// Created in migration 20260919224658_v26_leave; this is the typed
// access layer lib/services/leave.ts consumes.
//
// annualQuota NULL means unlimited; quota is days per calendar year.
// isPaid distinguishes unpaid leave for V-30's payout deduction.

export const leaveTypes = pgTable(
  "leave_types",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    annualQuota: integer("annual_quota"),
    isPaid: boolean("is_paid").notNull().default(true),
    ...auditColumns,
  },
  (t) => [
    unique("leave_types_id_tenant_key").on(t.id, t.tenantId),
    unique("leave_types_tenant_name_key").on(t.tenantId, t.name),
    check("leave_types_name_check", sql`char_length(${t.name}) between 1 and 60`),
    check(
      "leave_types_quota_check",
      sql`${t.annualQuota} is null or ${t.annualQuota} >= 0`,
    ),
  ],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    staffId: uuid("staff_id").notNull().$type<StaffId>(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    // numeric(4,1) per the architecture sketch: half days fit later;
    // this pass writes whole days.
    days: numeric("days", { precision: 4, scale: 1 }).notNull(),
    reason: text("reason"),
    // pending | approved | rejected | cancelled
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").$type<StaffId>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...auditColumns,
  },
  (t) => [
    unique("leave_requests_id_tenant_key").on(t.id, t.tenantId),
    check("leave_requests_range_check", sql`${t.toDate} >= ${t.fromDate}`),
    check("leave_requests_days_check", sql`${t.days} > 0`),
    check(
      "leave_requests_status_check",
      sql`${t.status} in ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      "leave_requests_decision_check",
      sql`(${t.decidedBy} is null) = (${t.decidedAt} is null)`,
    ),
    foreignKey({
      name: "leave_requests_staff_tenant_fkey",
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "leave_requests_decided_by_tenant_fkey",
      columns: [t.decidedBy, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "leave_requests_type_tenant_fkey",
      columns: [t.leaveTypeId, t.tenantId],
      foreignColumns: [leaveTypes.id, leaveTypes.tenantId],
    }),
    index("leave_requests_tenant_staff_from_idx").on(
      t.tenantId,
      t.staffId,
      t.fromDate,
    ),
    index("leave_requests_tenant_status_idx").on(t.tenantId, t.status),
  ],
);

export type LeaveType = typeof leaveTypes.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
