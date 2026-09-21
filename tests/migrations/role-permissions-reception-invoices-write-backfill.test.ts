import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";

// PR2-C2 — receptionist invoices.write backfill.
//
// lib/services/roles.ts now seeds the receptionist template with
// invoices.write (the counter raises invoices). Existing tenants were
// seeded before that change, so their receptionist role lacks the
// grant. db/migrations/<ts>_role_permissions_reception_invoices_write.sql
// backfills it, idempotently, matching by role.key so a renamed role
// is untouched.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const MIGRATION_FILE = "db/migrations/20260921164407_role_permissions_reception_invoices_write.sql";

const tenants: string[] = [];

afterAll(async () => {
  for (const tenantId of tenants) {
    await admin.query("delete from role_permissions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  }
  await admin.end();
});

async function seedPreFixTenant(label: string): Promise<string> {
  const tenantId = asTenantId(uuidv7());
  const slug = `pr2-recep-inv-${label}-${RUN}-${uuidv7().slice(0, 8)}`;
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', 'Asia/Kolkata')",
    [tenantId, slug, `PR2 receptionist invoices ${label}`],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), tenantId],
  );
  // Simulate the pre-fix shape: the receptionist role without
  // invoices.write (every other seeded grant stays).
  await admin.query(
    `delete from role_permissions rp
       using roles r
       where rp.role_id = r.id
         and r.tenant_id = $1::uuid
         and r.key = 'receptionist'
         and rp.permission_key = 'invoices.write'`,
    [tenantId],
  );
  tenants.push(tenantId);
  return tenantId;
}

async function hasGrant(
  tenantId: string,
  roleKey: string,
  permKey: string,
): Promise<boolean> {
  const rows = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
       from role_permissions rp
       join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where r.tenant_id = $1::uuid
        and r.key = $2
        and rp.permission_key = $3`,
    [tenantId, roleKey, permKey],
  );
  return rows.rows.length > 0;
}

async function migrationSql(): Promise<string> {
  return readFileSync(MIGRATION_FILE, "utf8");
}

describe("receptionist invoices.write backfill migration", () => {
  it("grants invoices.write to the receptionist role in a pre-fix tenant", async () => {
    const tenantId = await seedPreFixTenant("grant");
    expect(await hasGrant(tenantId, "receptionist", "invoices.write")).toBe(false);

    await admin.query(await migrationSql());

    expect(await hasGrant(tenantId, "receptionist", "invoices.write")).toBe(true);
  });

  it("leaves every other role and grant untouched", async () => {
    const tenantId = await seedPreFixTenant("others");
    const before = await admin.query<{ role_key: string; permission_key: string }>(
      `select r.key as role_key, rp.permission_key
         from role_permissions rp
         join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
        where rp.tenant_id = $1::uuid
        order by r.key, rp.permission_key`,
      [tenantId],
    );

    await admin.query(await migrationSql());

    const after = await admin.query<{ role_key: string; permission_key: string }>(
      `select r.key as role_key, rp.permission_key
         from role_permissions rp
         join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
        where rp.tenant_id = $1::uuid
        order by r.key, rp.permission_key`,
      [tenantId],
    );
    const added = after.rows.filter(
      (row) =>
        !before.rows.some(
          (b) =>
            b.role_key === row.role_key &&
            b.permission_key === row.permission_key,
        ),
    );
    expect(added).toEqual([
      { role_key: "receptionist", permission_key: "invoices.write" },
    ]);
  });

  it("is idempotent — applying it twice changes nothing the second time", async () => {
    const tenantId = await seedPreFixTenant("idempotent");
    await admin.query(await migrationSql());
    const first = await admin.query<{ permission_key: string }>(
      `select rp.permission_key from role_permissions rp
        join roles r on r.id = rp.role_id
       where r.tenant_id = $1::uuid and r.key = 'receptionist'
       order by rp.permission_key`,
      [tenantId],
    );

    await admin.query(await migrationSql());

    const second = await admin.query<{ permission_key: string }>(
      `select rp.permission_key from role_permissions rp
        join roles r on r.id = rp.role_id
       where r.tenant_id = $1::uuid and r.key = 'receptionist'
       order by rp.permission_key`,
      [tenantId],
    );
    expect(second.rows).toEqual(first.rows);
  });

  it("does not touch a renamed receptionist role", async () => {
    const tenantId = await seedPreFixTenant("renamed");
    await admin.query(
      "update roles set key = 'front-desk' where tenant_id = $1::uuid and key = 'receptionist'",
      [tenantId],
    );

    await admin.query(await migrationSql());

    expect(await hasGrant(tenantId, "front-desk", "invoices.write")).toBe(false);
  });
});
