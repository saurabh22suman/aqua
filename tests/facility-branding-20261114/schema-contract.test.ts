import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { asTenantId } from "@/lib/ids";

// Catalogue queries need no business fixture or privileged connection. They
// make forward-expansion expectations fail as assertions on the old schema,
// rather than as missing-relation errors during test setup.
async function tableContract(name: string) {
  return withTenant(asTenantId(uuidv7()), async (tx) => {
    const result = await tx.execute(sql`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        has_table_privilege('app_user', c.oid, 'SELECT') as can_read,
        has_table_privilege('app_user', c.oid, 'INSERT') as can_insert,
        has_table_privilege('app_user', c.oid, 'UPDATE') as can_update,
        has_table_privilege('app_user', c.oid, 'DELETE') as can_delete
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = ${name}
    `);
    return result.rows;
  });
}

describe("Approved tenant asset and facility billing forward expansion", () => {
  it("provides a forced-RLS bounded branding table with immutable bytes", async () => {
    const rows = await tableContract("branding_assets");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rls: true, forced: true, can_read: true, can_insert: true,
      can_update: false, can_delete: true,
    });
  });

  it("provides forced-RLS append-only registration versions", async () => {
    const rows = await tableContract("billing_registrations");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rls: true, forced: true, can_read: true, can_insert: true,
      can_update: false, can_delete: false,
    });
  });

  it("provides tenant-isolated physical-site billing settings", async () => {
    const rows = await tableContract("location_billing_settings");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rls: true, forced: true });
  });

  it("keeps new legal issuer fields nullable for existing club defaults", async () => {
    const result = await withTenant(asTenantId(uuidv7()), (tx) => tx.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
        and column_name in ('billing_legal_name', 'billing_legal_address', 'billing_state_code')
        and is_nullable = 'YES'
    `));
    expect(result.rows).toHaveLength(3);
  });
});
