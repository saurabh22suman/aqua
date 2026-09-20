import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";

// V-23/V-24 — role_permissions backfill for `staff.self`.
//
// Self-service staff actions (own roster, own check-in/out, own leave
// requests) are gated by staff.self, seeded for owner/admin (full key
// list) and explicitly for accountant/receptionist/coach/worker.
// Existing tenants were seeded before the key existed and need
// db/migrations/20260919223022_v23_staff_self_backfill.sql.
//
// This test simulates the pre-fix tenant (strip the new grant after
// seeding), applies the same SQL the migration ships, and asserts the
// repaired state. The mutation proof is the grant itself: deleting the
// insert turns the first assertion red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

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
  const slug = `v23-self-${label}-${RUN}-${uuidv7().slice(0, 8)}`;
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', 'Asia/Kolkata')",
    [tenantId, slug, `V23 self backfill ${label}`],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), tenantId],
  );
  // Strip the new grant to simulate a tenant seeded before staff.self.
  await admin.query(
    `delete from role_permissions rp
       using roles r
       where rp.role_id = r.id
         and r.tenant_id = $1::uuid
         and rp.permission_key = 'staff.self'`,
    [tenantId],
  );
  tenants.push(tenantId);
  return tenantId;
}

async function hasGrant(tenantId: string, roleKey: string, permKey: string): Promise<boolean> {
  const { rows } = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
       from role_permissions rp
       join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where r.tenant_id = $1::uuid
        and r.key = $2
        and rp.permission_key = $3`,
    [tenantId, roleKey, permKey],
  );
  return rows.length > 0;
}

const BACKFILL_SQL = `insert into role_permissions (tenant_id, role_id, permission_key)
select r.tenant_id, r.id, 'staff.self'
from roles r
where r.key in ('owner', 'admin', 'accountant', 'coach', 'receptionist', 'worker')
on conflict do nothing`;

describe("staff.self backfill: db/migrations/20260919223022_v23_staff_self_backfill.sql", () => {
  it("grants staff.self to every seeded role in a pre-fix tenant", async () => {
    const tenantId = await seedPreFixTenant("all-roles");
    for (const role of ["owner", "admin", "accountant", "coach", "receptionist", "worker"]) {
      expect(await hasGrant(tenantId, role, "staff.self")).toBe(false);
    }

    await admin.query(BACKFILL_SQL);

    for (const role of ["owner", "admin", "accountant", "coach", "receptionist", "worker"]) {
      expect(await hasGrant(tenantId, role, "staff.self")).toBe(true);
    }
  });

  it("is idempotent — a second run changes nothing", async () => {
    const tenantId = await seedPreFixTenant("idempotent");
    await admin.query(BACKFILL_SQL);
    const afterFirst = await hasGrant(tenantId, "coach", "staff.self");
    await admin.query(BACKFILL_SQL);
    expect(await hasGrant(tenantId, "coach", "staff.self")).toBe(afterFirst);
  });

  it("leaves a renamed role untouched", async () => {
    const tenantId = await seedPreFixTenant("customised");
    await admin.query(
      "update roles set key = 'head-coach' where tenant_id = $1::uuid and key = 'coach'",
      [tenantId],
    );
    await admin.query(BACKFILL_SQL);

    const { rows } = await admin.query<{ permission_key: string }>(
      `select rp.permission_key
         from role_permissions rp
         join roles r on r.id = rp.role_id
        where r.tenant_id = $1::uuid and r.key = 'head-coach'`,
      [tenantId],
    );
    expect(rows.map((r) => r.permission_key)).not.toContain("staff.self");
  });
});
