import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  foreignKey,
  integer,
  time,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { staff } from "./staff";
import type { TenantId, StaffId } from "@/lib/ids";

export const programs = pgTable(
  "programs",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    name: text("name").notNull(),
    description: text("description"),
    // Phase 2.2a — applyPreset engine flags every seeded program
    // as is_sample so 2.3's "remove sample data" affordance can
    // bulk-delete the engine's output without touching the
    // operator's later additions.
    isSample: boolean("is_sample").notNull().default(false),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [unique("programs_id_tenant_key").on(t.id, t.tenantId)],
);

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    programId: uuid("program_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    daysOfWeek: integer("days_of_week").array().notNull().default([]),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    // Phase 2.2a — applyPreset engine flags every seeded batch
    // as is_sample so 2.3's "remove sample data" affordance can
    // bulk-delete the engine's output without touching the
    // operator's later additions.
    isSample: boolean("is_sample").notNull().default(false),
    // C-04: real FK to staff, migrated from a bare user id in
    // migration 0018. See that migration's comment for the backfill.
    // Branded StaffId (M3) -- this is the exact column whose meaning
    // changed from "a user id" to "a staff id" and left a stale
    // comparison against ctx.userId compiling cleanly. See
    // lib/ids.ts and docs/agent-lanes.md's history.
    coachId: uuid("coach_id").$type<StaffId>(),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("batches_id_tenant_key").on(t.id, t.tenantId),
    check("batches_capacity_check", sql`${t.capacity} > 0`),
    foreignKey({
      name: "batches_program_tenant_fkey",
      columns: [t.programId, t.tenantId],
      foreignColumns: [programs.id, programs.tenantId],
    }),
    foreignKey({
      name: "batches_coach_tenant_fkey",
      columns: [t.coachId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
  ],
);

export type Program = typeof programs.$inferSelect;
export type Batch = typeof batches.$inferSelect;