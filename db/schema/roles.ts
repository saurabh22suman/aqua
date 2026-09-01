import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { permissions } from "./platform";
import type { TenantId, UserId } from "@/lib/ids";

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    // Data, not a role-name branch (F-04's Never): the landing route and
    // the tie-break priority when a user holds several memberships. See
    // db/migrations/0012_roles_home_routing.sql.
    homePath: text("home_path").notNull().default("/parent"),
    homeOrdinal: integer("home_ordinal").notNull().default(3),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("roles_tenant_key_key").on(t.tenantId, t.key),
    unique("roles_id_tenant_key").on(t.id, t.tenantId),
    index("roles_tenant_live_idx")
      .on(t.tenantId)
      .where(sql`deleted_at is null`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    grantedBy: uuid("granted_by").$type<UserId>(),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      name: "role_permissions_pkey",
      columns: [t.tenantId, t.roleId, t.permissionKey],
    }),
    foreignKey({
      name: "role_permissions_role_tenant_fkey",
      columns: [t.roleId, t.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "role_permissions_permission_key_fkey",
      columns: [t.permissionKey],
      foreignColumns: [permissions.key],
    }),
  ],
);

export type Role = typeof roles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
