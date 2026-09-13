import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
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
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { members } from "./people";
import { batches } from "./programs";
import { staff } from "./staff";
import { locations } from "./locations";
import type { TenantId, MemberId, StaffId, UserId } from "@/lib/ids";

export const enrolments = pgTable(
  "enrolments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    batchId: uuid("batch_id").notNull(),
    enrolledOn: date("enrolled_on").notNull().defaultNow(),
    ...auditColumns,
  },
  (t) => [
    unique("enrolments_tenant_member_batch_day_key").on(
      t.tenantId,
      t.memberId,
      t.batchId,
      t.enrolledOn,
    ),
    foreignKey({
      name: "enrolments_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "enrolments_batch_tenant_fkey",
      columns: [t.batchId, t.tenantId],
      foreignColumns: [batches.id, batches.tenantId],
    }),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    batchId: uuid("batch_id").notNull(),
    // O-02 — copied from the batch at generation time. Nullable for
    // the same reason batches.location_id is: tenant-wide sessions
    // stay tenant-wide instead of being guessed at a site.
    locationId: uuid("location_id"),
    sessionDate: date("session_date").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    // Copied from the batch at generation time; independently
    // updatable for substitution (C-20). Real FK to staff as of
    // migration 0018 -- see that migration's comment for the backfill.
    // Branded StaffId (M3) -- see programs.ts's batches.coachId comment.
    coachId: uuid("coach_id").$type<StaffId>(),
    ...auditColumns,
  },
  (t) => [
    unique("sessions_tenant_batch_date_key").on(t.tenantId, t.batchId, t.sessionDate),
    unique("sessions_id_tenant_key").on(t.id, t.tenantId),
    index("sessions_tenant_starts_idx").on(t.tenantId, t.startsAt),
    index("sessions_tenant_location_idx").on(t.tenantId, t.locationId),
    foreignKey({
      name: "sessions_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    check(
      "sessions_status_check",
      sql`${t.status} in ('scheduled', 'held', 'cancelled')`,
    ),
    foreignKey({
      name: "sessions_batch_tenant_fkey",
      columns: [t.batchId, t.tenantId],
      foreignColumns: [batches.id, batches.tenantId],
    }),
    foreignKey({
      name: "sessions_coach_tenant_fkey",
      columns: [t.coachId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
  ],
);

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    sessionId: uuid("session_id").notNull(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    // O-02 — copied from the session in the same transaction as the
    // mark. Nullable only when the session itself is tenant-wide.
    locationId: uuid("location_id"),
    status: text("status").notNull().default("present"),
    clientId: text("client_id").notNull(),
    markedBy: uuid("marked_by").$type<UserId>(),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    ...auditColumns,
  },
  (t) => [
    unique("attendance_tenant_session_member_key").on(t.tenantId, t.sessionId, t.memberId),
    unique("attendance_tenant_client_key").on(t.tenantId, t.clientId),
    index("attendance_tenant_session_idx").on(t.tenantId, t.sessionId),
    index("attendance_tenant_location_idx").on(t.tenantId, t.locationId),
    foreignKey({
      name: "attendance_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
    check(
      "attendance_status_check",
      sql`${t.status} in ('present', 'absent', 'late')`,
    ),
    foreignKey({
      name: "attendance_session_tenant_fkey",
      columns: [t.sessionId, t.tenantId],
      foreignColumns: [sessions.id, sessions.tenantId],
    }),
    foreignKey({
      name: "attendance_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
  ],
);

export type Enrolment = typeof enrolments.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
