import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { locations } from "./locations";
import { roles } from "./roles";

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id").notNull(),
    allLocations: boolean("all_locations").notNull().default(true),
    status: text("status").notNull().default("invited"),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("tenant_memberships_tenant_user_key").on(t.tenantId, t.userId),
    unique("tenant_memberships_id_tenant_key").on(t.id, t.tenantId),
    foreignKey({
      name: "tenant_memberships_role_tenant_fkey",
      columns: [t.roleId, t.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    }),
    check(
      "tenant_memberships_status_check",
      sql`${t.status} in ('invited', 'active', 'revoked')`,
    ),
    index("tenant_memberships_tenant_idx").on(t.tenantId),
  ],
);

export const membershipLocations = pgTable(
  "membership_locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    membershipId: uuid("membership_id").notNull(),
    locationId: uuid("location_id").notNull(),
    ...auditColumns,
  },
  (t) => [
    unique("membership_locations_tenant_membership_location_key").on(
      t.tenantId,
      t.membershipId,
      t.locationId,
    ),
    foreignKey({
      name: "membership_locations_membership_tenant_fkey",
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [tenantMemberships.id, tenantMemberships.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "membership_locations_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type MembershipLocation = typeof membershipLocations.$inferSelect;
