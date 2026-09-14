import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { staff } from "./staff";
import { locations } from "./locations";
import type { TenantId, StaffId } from "@/lib/ids";

// O-01 (docs/ops-platform-design.md §8) — staff are many-to-many with
// locations: a coach can work across sites, a receptionist can be
// scoped to one. is_primary marks a staff member's home site; the
// partial unique index keeps it to one per staff member.
export const staffLocations = pgTable(
  "staff_locations",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    staffId: uuid("staff_id").notNull().$type<StaffId>(),
    locationId: uuid("location_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    ...auditColumns,
  },
  (t) => [
    unique("staff_locations_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("staff_locations_tenant_staff_location_key").on(
      t.tenantId,
      t.staffId,
      t.locationId,
    ),
    uniqueIndex("staff_locations_tenant_staff_primary_uidx")
      .on(t.tenantId, t.staffId)
      .where(sql`is_primary`),
    index("staff_locations_tenant_location_idx").on(t.tenantId, t.locationId),
    foreignKey({
      name: "staff_locations_staff_tenant_fkey",
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }),
    foreignKey({
      name: "staff_locations_staff_tenant_fkey",
      columns: [t.staffId, t.tenantId],
      foreignColumns: [staff.id, staff.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "staff_locations_location_tenant_fkey",
      columns: [t.locationId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }).onDelete("cascade"),
  ],
);

export type StaffLocation = typeof staffLocations.$inferSelect;
export type NewStaffLocation = typeof staffLocations.$inferInsert;
