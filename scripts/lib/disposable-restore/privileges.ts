// B6 — the privilege properties of a restored database.
//
// Three separate questions, three separate answers:
//
//   1. MAY the application role read and write the restored tables?
//   2. Are the append-only tables still append-only?
//   3. Did the restore leave the application role able to bypass RLS?
//
// The third one is the dangerous one. A dump taken with
// --no-owner --no-privileges carries no role definitions, so the
// target's roles come from the target's own bootstrap — but a restore
// that somehow granted SUPERUSER or BYPASSRLS would silently
// dismantle every RLS policy in the schema, and the drill would still
// report "restored successfully".

import type { Pool } from "pg";
import { RLS_EXEMPT_TABLES } from "@/db/allowlist";

export type GrantCheck = {
  missing: string[];
  appendOnlyViolations: string[];
};

export type RlsCheck = {
  notEnabled: string[];
  notForced: string[];
};

export type RoleAttributeCheck = {
  superuser: string[];
  bypassRls: string[];
};

const GRANTED_TABLES = [
  "tenants",
  "locations",
  "roles",
  "tenant_memberships",
  "members",
  "persons",
  "invoices",
  "payments",
] as const;

/** Tables the application role must NOT be able to update or delete. */
const APPEND_ONLY_TABLES = [
  "audit_log",
  "activity_events",
  "announcements",
  "account_entries",
] as const;

export async function checkGrants(pool: Pool): Promise<GrantCheck> {
  const missing: string[] = [];
  for (const table of GRANTED_TABLES) {
    const { rows } = await pool.query<{ ok: boolean }>(
      "select has_table_privilege('app_user', $1, 'select,insert,update,delete') as ok",
      [table],
    );
    if (!rows[0]?.ok) missing.push(table);
  }

  const appendOnlyViolations: string[] = [];
  for (const table of APPEND_ONLY_TABLES) {
    const { rows } = await pool.query<{ ok: boolean; present: boolean }>(
      `select to_regclass($1) is not null as present,
              coalesce(has_table_privilege('app_user', $1, 'update,delete'), false) as ok`,
      [`public.${table}`],
    );
    if (rows[0]?.present && rows[0].ok) appendOnlyViolations.push(table);
  }

  return { missing, appendOnlyViolations };
}

/**
 * The runbook's own query (docs/deployment.md, "Backups and restore"):
 * every public table carrying a tenant_id must have RLS enabled AND
 * forced. platform_audit_log is platform-wide and carries a tenant
 * reference for filtering only.
 */
export async function checkRls(pool: Pool): Promise<RlsCheck> {
  const { rows } = await pool.query<{
    relname: string;
    rls: boolean;
    forced: boolean;
  }>(
    `select c.relname,
            c.relrowsecurity      as rls,
            c.relforcerowsecurity as forced
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and c.relname <> 'platform_audit_log'
        and exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id'
                      and not a.attisdropped)`,
  );

  const notEnabled: string[] = [];
  const notForced: string[] = [];
  for (const row of rows) {
    if (RLS_EXEMPT_TABLES.has(row.relname)) continue;
    if (!row.rls) notEnabled.push(row.relname);
    if (!row.forced) notForced.push(row.relname);
  }
  return { notEnabled, notForced };
}

export async function checkRoleAttributes(
  pool: Pool,
): Promise<RoleAttributeCheck> {
  const { rows } = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `select rolname, rolsuper, rolbypassrls
       from pg_roles
      where rolname in ('app_user', 'app_login')`,
  );
  return {
    superuser: rows.filter((r) => r.rolsuper).map((r) => r.rolname),
    bypassRls: rows.filter((r) => r.rolbypassrls).map((r) => r.rolname),
  };
}
