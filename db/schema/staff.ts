import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { check, date, foreignKey, index, pgTable, text, uniqueIndex, unique, uuid } from "drizzle-orm/pg-core";
import { auditColumns, softDelete } from "./_shared";
import { tenants } from "./tenants";
import { persons } from "./people";
import { users } from "./users";
import type { TenantId, PersonId, StaffId, UserId } from "@/lib/ids";

// C-04: one person can be both a coach and a member (persons is the
// single identity table -- see architecture.md §8.3). staffType is a
// plain column, not a role key: F-04's "Never" (no runtime branching
// on a role name) applies here the same way it does to roles.key.
export const staff = pgTable(
  "staff",
  {
    id: uuid("id")
      .primaryKey()
      .$defaultFn(() => uuidv7())
      .$type<StaffId>(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id)
      .$type<TenantId>(),
    personId: uuid("person_id").notNull().$type<PersonId>(),
    // Optional: a staff member does not necessarily have a login
    // (e.g. a worker paid cash with no app access yet).
    userId: uuid("user_id").references(() => users.id).$type<UserId>(),
    staffType: text("staff_type").notNull(),
    employedOn: date("employed_on"),
    ...softDelete,
    ...auditColumns,
  },
  (t) => [
    unique("staff_id_tenant_key").on(t.id, t.tenantId),
    uniqueIndex("staff_tenant_person_type_key")
      .on(t.tenantId, t.personId, t.staffType)
      .where(sql`deleted_at is null`),
    index("staff_tenant_live_idx").on(t.tenantId).where(sql`deleted_at is null`),
    check(
      "staff_type_check",
      sql`${t.staffType} in ('coach', 'receptionist', 'worker', 'accountant')`,
    ),
    foreignKey({
      name: "staff_person_tenant_fkey",
      columns: [t.personId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
  ],
);

export type Staff = typeof staff.$inferSelect;
export type StaffType = "coach" | "receptionist" | "worker" | "accountant";
