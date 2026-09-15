import { getTableName, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// C-33/C-34 — the display label for a user id referenced by a payment
// (`received_by`) or a cash count (`confirmed_by`). A raw phone number
// is a poor label in a collections report; the name is resolvable
// through two tenant-scoped paths:
//
//   1. tenant_memberships -> users.person_id -> persons.full_name
//      (the path the invite-persons backfill maintains in production);
//   2. staff.user_id -> staff.person_id -> persons.full_name
//      (covers staff whose login predates the person link).
//
// Scalar subqueries, not joins: a person who is both coach and
// receptionist has two staff rows, and a join would multiply the
// payment rows. users is reached only through tenant_memberships
// (db/CLAUDE.md).

// A column reference inside this fragment must be table-qualified by
// hand: the fragment is built outside any query context, so a plain
// `${column}` would render as a bare identifier and collide with the
// subquery's own columns ("tenant_id is ambiguous").
function qualified(column: AnyPgColumn): SQL {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

export function userNameFor(
  tenantColumn: AnyPgColumn,
  userColumn: AnyPgColumn,
): SQL<string | null> {
  const tenant = qualified(tenantColumn);
  const user = qualified(userColumn);
  return sql<string | null>`coalesce(
    (
      select p.full_name
        from tenant_memberships tm
        join users u on u.id = tm.user_id
        join persons p on p.id = u.person_id and p.tenant_id = tm.tenant_id
       where tm.tenant_id = ${tenant}
         and tm.user_id = ${user}
         and tm.deleted_at is null
       limit 1
    ),
    (
      select p.full_name
        from staff s
        join persons p on p.id = s.person_id and p.tenant_id = s.tenant_id
       where s.tenant_id = ${tenant}
         and s.user_id = ${user}
       limit 1
    )
  )`;
}

// Last-resort label: the membership's role name ("Owner",
// "Receptionist") for a user with no person record — an owner who is
// not on the staff roster still recorded the payment.
export function userRoleNameFor(
  tenantColumn: AnyPgColumn,
  userColumn: AnyPgColumn,
): SQL<string | null> {
  const tenant = qualified(tenantColumn);
  const user = qualified(userColumn);
  return sql<string | null>`(
    select r.name
      from tenant_memberships tm
      join roles r on r.id = tm.role_id
     where tm.tenant_id = ${tenant}
       and tm.user_id = ${user}
       and tm.deleted_at is null
     order by tm.created_at
     limit 1
  )`;
}

export function userLabel(
  name: string | null,
  roleName: string | null,
): string {
  return name ?? roleName ?? "Unknown user";
}
