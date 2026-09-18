import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { integer, jsonb, pgTable, text, unique, uuid, foreignKey, index, boolean, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { members } from "./people";
import { users } from "./users";
import type { TenantId } from "@/lib/ids";

// M-03 — generic skill framework (architecture §8.12). Additive to the
// swim-shaped skill_levels/skills, which stay for the presets until the
// follow-up data migration. M-02 is deferred, so the link is the
// activity type key, not a `resource`/`activity` row.

export const skillFrameworks = pgTable(
  "skill_frameworks",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    activityTypeKey: text("activity_type_key").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    unique("skill_frameworks_id_tenant_key").on(t.id, t.tenantId),
    index("skill_frameworks_tenant_activity_active_idx")
      .on(t.tenantId, t.activityTypeKey)
      .where(sql`${t.isActive}`),
  ],
);

export const skillNodes = pgTable(
  "skill_nodes",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    frameworkId: uuid("framework_id").notNull(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    ordinal: integer("ordinal").notNull(),
    rubric: jsonb("rubric").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    unique("skill_nodes_id_tenant_key").on(t.id, t.tenantId),
    index("skill_nodes_tenant_framework_ordinal_idx").on(
      t.tenantId,
      t.frameworkId,
      t.ordinal,
    ),
    index("skill_nodes_tenant_parent_idx").on(t.tenantId, t.parentId),
    foreignKey({
      name: "skill_nodes_framework_tenant_fkey",
      columns: [t.frameworkId, t.tenantId],
      foreignColumns: [skillFrameworks.id, skillFrameworks.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "skill_nodes_parent_tenant_fkey",
      columns: [t.parentId, t.tenantId],
      foreignColumns: [t.id, t.tenantId],
    }).onDelete("cascade"),
  ],
);

export const assessments = pgTable(
  "assessments",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull(),
    nodeId: uuid("node_id").notNull(),
    band: integer("band").notNull(),
    assessedBy: uuid("assessed_by").references(() => users.id),
    assessedAt: timestamp("assessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("assessments_id_tenant_key").on(t.id, t.tenantId),
    index("assessments_tenant_member_assessed_idx").on(
      t.tenantId,
      t.memberId,
      t.assessedAt.desc(),
    ),
    index("assessments_tenant_node_idx").on(t.tenantId, t.nodeId),
    foreignKey({
      name: "assessments_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "assessments_node_tenant_fkey",
      columns: [t.nodeId, t.tenantId],
      foreignColumns: [skillNodes.id, skillNodes.tenantId],
    }).onDelete("cascade"),
  ],
);

export type SkillFramework = typeof skillFrameworks.$inferSelect;
export type SkillNode = typeof skillNodes.$inferSelect;
export type Assessment = typeof assessments.$inferSelect;
