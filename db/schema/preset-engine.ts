import {
  bigint,
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { sql } from "drizzle-orm";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import type { TenantId } from "@/lib/ids";

// Phase 2.2a — schema for the applyPreset engine. The tables
// defined here were created in migration
// 20260902230000_preset_engine_schema.sql (with is_sample on
// programs and batches too). This file is the typed access layer
// the engine consumes. The RLS posture (tenant_isolation +
// platform_admin_select / platform_admin_write) is identical to
// the other tenant-scoped tables in this repo.

// skill_levels — one per program/preset ladder. Each level has a
// numeric ordinal (so the order is data, not insert-order) and a
// many-to-one to skills. is_sample flags rows the engine seeded;
// 2.3's "remove sample data" affordance filters on it.
export const skillLevels = pgTable(
  "skill_levels",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("skill_levels_id_tenant_key").on(t.id, t.tenantId),
    check("skill_levels_ordinal_check", sql`${t.ordinal} > 0`),
  ],
);

export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    skillLevelId: uuid("skill_level_id").notNull(),
    name: text("name").notNull(),
    // rubric: { "1": "...", "2": "...", "3": "...", "4": "..." }
    // A four-level rubric per architecture §7.4. Zod-validated at
    // the applyPreset read path; stored as jsonb here.
    rubric: jsonb("rubric").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("skills_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "skills_skill_level_tenant_fkey",
      columns: [t.skillLevelId, t.tenantId],
      foreignColumns: [skillLevels.id, skillLevels.tenantId],
    }).onDelete("cascade"),
  ],
);

// plan_shapes — the membership plan shape concept from
// architecture §7.4. amount_paise is deliberately nullable
// (per the architecture's "no seeded prices" rule); the wizard
// makes the field required before activation. kind is "duration"
// (uses duration_days) or "sessions" (uses sessions); the
// engine writes one row per shape, the wizard picks one to
// activate with an amount.
export const planShapes = pgTable(
  "plan_shapes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    durationDays: integer("duration_days"),
    sessions: integer("sessions"),
    amountPaise: bigint("amount_paise", { mode: "bigint" }),
    currency: text("currency").notNull().default("INR"),
    isSample: boolean("is_sample").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("plan_shapes_id_tenant_key").on(t.id, t.tenantId),
    check(
      "plan_shapes_kind_check",
      sql`${t.kind} in ('duration', 'sessions')`,
    ),
    check(
      "plan_shapes_kind_payload_check",
      sql`(${t.kind} = 'duration' and ${t.durationDays} is not null and ${t.sessions} is null) or (${t.kind} = 'sessions' and ${t.sessions} is not null and ${t.durationDays} is null)`,
    ),
  ],
);

// facilities — kind and capacity per the §7.4 shape. Sub-units
// (lanes, courts, etc.) are a separate table to keep the parent
// row light and the per-unit list query cheap.
export const facilities = pgTable(
  "facilities",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    capacity: integer("capacity").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("facilities_id_tenant_key").on(t.id, t.tenantId),
    check(
      "facilities_kind_check",
      sql`${t.kind} in ('pool', 'court', 'turf', 'studio', 'field')`,
    ),
    check("facilities_capacity_check", sql`${t.capacity} > 0`),
  ],
);

export const facilitySubUnits = pgTable(
  "facility_sub_units",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    facilityId: uuid("facility_id").notNull(),
    name: text("name").notNull(),
    ...auditColumns,
  },
  (t) => [
    unique("facility_sub_units_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "facility_sub_units_facility_tenant_fkey",
      columns: [t.facilityId, t.tenantId],
      foreignColumns: [facilities.id, facilities.tenantId],
    }).onDelete("cascade"),
  ],
);

// message_templates — a tenant's copy of a platform message
// template (one row per template key per tenant). The `content`
// text is the rendered body; future work will substitute
// {{var}} placeholders at send time. is_sample flags the
// engine-seeded copies that the operator can wipe via 2.3.
export const messageTemplates = pgTable(
  "message_templates",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    key: text("key").notNull(),
    content: text("content").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("message_templates_id_tenant_key").on(t.id, t.tenantId),
    unique("message_templates_tenant_key_key").on(t.tenantId, t.key),
  ],
);

// Re-export the types.
export type SkillLevel = typeof skillLevels.$inferSelect;
export type NewSkillLevel = typeof skillLevels.$inferInsert;
export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type PlanShape = typeof planShapes.$inferSelect;
export type NewPlanShape = typeof planShapes.$inferInsert;
export type Facility = typeof facilities.$inferSelect;
export type NewFacility = typeof facilities.$inferInsert;
export type FacilitySubUnit = typeof facilitySubUnits.$inferSelect;
export type NewFacilitySubUnit = typeof facilitySubUnits.$inferInsert;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type NewMessageTemplate = typeof messageTemplates.$inferInsert;
