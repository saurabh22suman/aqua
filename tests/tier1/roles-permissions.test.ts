import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { roles, rolePermissions } from "@/db/schema/roles";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId } from "@/lib/ids";

// tenants has FORCE row level security, so tenant fixtures must be created
// through the privileged migration pool, never the app pool. The role
// rows themselves are seeded by seedRoleTemplates, which runs under
// withTenant() — deliberately proving the RLS-scoped path works.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const TENANT_IDS = [tenantA, tenantB];

// The F-04 approved matrix, hardcoded here as an independent cross-check
// against lib/services/roles.ts. NOTE: the task text says "29 permissions"
// but lists 30; this is the verbatim list, all 30 rows.
const ALL_PERMISSION_KEYS = [
  "members.read",
  "members.write",
  "members.delete",
  "attendance.read",
  "attendance.mark",
  "programs.read",
  "programs.write",
  "enquiries.read",
  "enquiries.write",
  "invoices.read",
  "invoices.write",
  "payments.read",
  "payments.record",
  "staff.read",
  "staff.write",
  "staff.invite",
  "staff.attendance",
  "staff.roster",
  "staff.pay.read",
  "staff.pay.write",
  "reports.operational",
  "reports.financial",
  "settings.read",
  "settings.manage",
  "messaging.send",
  "messaging.templates",
  "bookings.read",
  "bookings.write",
  "levels.read",
  "levels.assess",
];

const ROLE_MATRIX: Record<string, string[]> = {
  owner: [...ALL_PERMISSION_KEYS].sort(),
  admin: ALL_PERMISSION_KEYS.filter(
    (k) => k !== "staff.pay.read" && k !== "staff.pay.write",
  ).sort(),
  accountant: [
    "invoices.read",
    "invoices.write",
    "payments.read",
    "payments.record",
    "reports.financial",
    "reports.operational",
    "staff.pay.read",
    "members.read",
    "settings.read",
  ].sort(),
  receptionist: [
    "members.read",
    "members.write",
    "attendance.read",
    "attendance.mark",
    "enquiries.read",
    "enquiries.write",
    "invoices.read",
    "payments.record",
    "bookings.read",
    "bookings.write",
    "staff.attendance",
    "messaging.send",
    "programs.read",
    "settings.read",
  ].sort(),
  coach: [
    "attendance.read",
    "attendance.mark",
    "members.read",
    "programs.read",
    "levels.read",
    "levels.assess",
  ].sort(),
  worker: ["staff.roster"],
};

const TEMPLATE_KEYS = Object.keys(ROLE_MATRIX).sort();

async function grantedPermissions(
  tenantId: string,
  roleKey: string,
): Promise<string[]> {
  const { rows } = await admin.query<{ permission_key: string }>(
    `select rp.permission_key
     from role_permissions rp
     join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
     where r.tenant_id = $1 and r.key = $2
     order by rp.permission_key`,
    [tenantId, roleKey],
  );
  return rows.map((r) => r.permission_key);
}

afterAll(async () => {
  await admin.query("delete from roles where tenant_id = any($1)", [
    TENANT_IDS,
  ]);
  await admin.query("delete from tenants where id = any($1)", [TENANT_IDS]);
  await admin.end();
});

describe("F-04 roles and permissions", () => {
  it("templates seed per tenant: six is_system roles matching the matrix", async () => {
    await admin.query(
      "insert into tenants (id, slug, name) values ($1, $2, 'Roles A'), ($3, $4, 'Roles B')",
      [tenantA, `roles-a-${RUN}`, tenantB, `roles-b-${RUN}`],
    );

    await seedRoleTemplates(tenantA);
    await seedRoleTemplates(tenantB);

    for (const tenantId of [tenantA, tenantB]) {
      const { rows } = await admin.query<{
        key: string;
        is_system: boolean;
        name: string;
      }>(
        "select key, is_system, name from roles where tenant_id = $1 order by key",
        [tenantId],
      );
      expect(rows).toHaveLength(6);
      expect(rows.map((r) => r.key)).toEqual(TEMPLATE_KEYS);
      for (const row of rows) expect(row.is_system).toBe(true);

      for (const [roleKey, expected] of Object.entries(ROLE_MATRIX)) {
        const granted = await grantedPermissions(tenantId, roleKey);
        expect(granted, `${roleKey} matrix mismatch`).toEqual(expected);
      }

      const receptionist = await grantedPermissions(tenantId, "receptionist");
      const payLeaks = receptionist.filter((k) => k.startsWith("staff.pay."));
      expect(payLeaks).toEqual([]);
    }
  });

  it("templates are editable: rename, revoke and grant survive a re-seed", async () => {
    const receptionistId = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'receptionist'",
        [tenantA],
      )
    ).rows[0].id;

    await admin.query(
      "update roles set name = 'Front Desk' where id = $1",
      [receptionistId],
    );
    await admin.query(
      "delete from role_permissions where tenant_id = $1 and role_id = $2 and permission_key = 'members.write'",
      [tenantA, receptionistId],
    );
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) values ($1, $2, 'settings.manage')",
      [tenantA, receptionistId],
    );

    await seedRoleTemplates(tenantA);

    const renamed = await admin.query<{ name: string }>(
      "select name from roles where id = $1",
      [receptionistId],
    );
    expect(renamed.rows[0].name).toBe("Front Desk");

    const granted = await grantedPermissions(tenantA, "receptionist");
    expect(granted).not.toContain("members.write");
    expect(granted).toContain("settings.manage");
  });

  it("tenant A cannot see tenant B roles or grants under RLS", async () => {
    const leakedRoles = await withTenant(tenantA, (tx) =>
      tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.tenantId, tenantB)),
    );
    expect(leakedRoles).toHaveLength(0);

    const leakedGrants = await withTenant(tenantA, (tx) =>
      tx
        .select({ roleId: rolePermissions.roleId })
        .from(rolePermissions)
        .where(eq(rolePermissions.tenantId, tenantB)),
    );
    expect(leakedGrants).toHaveLength(0);
  });
});
