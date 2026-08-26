import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  foreignKey,
  index,
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

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
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
      .references(() => tenants.id),
    roleId: uuid("role_id").notNull(),
    permissionKey: text("permission_key").notNull(),
    grantedBy: uuid("granted_by"),
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
