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
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { locations } from "./locations";

export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    fullName: text("full_name").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    medicalNotes: text("medical_notes"),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    index("persons_tenant_live_idx")
      .on(t.tenantId)
      .where(sql`deleted_at is null`),
    unique("persons_id_tenant_key").on(t.id, t.tenantId),
  ],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    personId: uuid("person_id").notNull(),
    locationId: uuid("location_id").notNull(),
    memberCode: text("member_code").notNull(),
    status: text("status").notNull().default("active"),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("members_tenant_member_code_key").on(t.tenantId, t.memberCode),
    unique("members_id_tenant_key").on(t.id, t.tenantId),
    index("members_tenant_location_live_idx")
      .on(t.tenantId, t.locationId)
      .where(sql`deleted_at is null`),
    check(
      "members_status_check",
      sql`${t.status} in ('trial', 'active', 'paused', 'lapsed', 'left')`,
    ),
    foreignKey({
      name: "members_person_tenant_fkey",
      columns: [t.personId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
    foreignKey({
      name: "members_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

// C-08: one row per status change, insert-only (transitionMemberStatus
// in lib/services/member-status.ts is the only writer). See
// db/migrations/0016 for why this isn't the generic F-14 audit_log.
export const memberStatusTransitions = pgTable(
  "member_status_transitions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    memberId: uuid("member_id").notNull(),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("member_status_transitions_tenant_member_idx").on(
      t.tenantId,
      t.memberId,
      t.changedAt,
    ),
    foreignKey({
      name: "member_status_transitions_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
  ],
);

export type Person = typeof persons.$inferSelect;
export type Member = typeof members.$inferSelect;
export type MemberStatusTransition = typeof memberStatusTransitions.$inferSelect;
export type MemberStatus = "trial" | "active" | "paused" | "lapsed" | "left";
