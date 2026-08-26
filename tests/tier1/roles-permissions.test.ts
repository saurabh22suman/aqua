import { afterAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { roles, rolePermissions } from "@/db/schema/roles";
import { seedPlatformCatalogue } from "@/db/seed-platform";
import { seedRoleTemplates } from "@/lib/services/roles";
import { requireDefaultCtx } from "@/lib/auth/context";

// requireDefaultCtx needs a session; stub only the framework edges
// (better-auth session + next/headers). The database path it exercises —
// resolveDefaultMembership + resolveLocationIds — stays real.
const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: authUser.betterAuthId } }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

// tenants has FORCE row level security, so tenant fixtures must be created
// through the privileged migration pool, never the app pool. The role
// rows themselves are seeded by seedRoleTemplates, which runs under
// withTenant() — deliberately proving the RLS-scoped path works.
const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);
const tenantA = uuidv7();
const tenantB = uuidv7();
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

const cleanupPhones: string[] = [];
const cleanupLocationIds: string[] = [];

async function expectPgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
    return {};
  } catch (err) {
    const e = err as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}

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
  await admin.query(
    "delete from tenant_memberships where user_id in (select id from users where phone = any($1))",
    [cleanupPhones],
  );
  await admin.query("delete from users where phone = any($1)", [cleanupPhones]);
  await admin.query("delete from locations where id = any($1)", [
    cleanupLocationIds,
  ]);
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

  it("every permissions.module value is a features.key row", async () => {
    const { rows } = await admin.query<{ module: string }>(
      `select distinct p.module
       from permissions p
       where not exists (select 1 from features f where f.key = p.module)`,
    );
    expect(rows).toEqual([]);
  });

  it("the permission catalogue is a closed list and the seed is idempotent", async () => {
    await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);
    await seedPlatformCatalogue(env.MIGRATION_DATABASE_URL);

    const { rows } = await admin.query<{ n: number }>(
      "select count(*)::int as n from permissions",
    );
    // 30 rows: the F-04 task text says 29 but its table lists 30, and the
    // seed code follows the table verbatim (see db/seed-platform.ts note).
    expect(rows[0].n).toBe(ALL_PERMISSION_KEYS.length);

    const keys = await admin.query<{ key: string }>(
      "select key from permissions order by key",
    );
    expect(keys.rows.map((r) => r.key)).toEqual(
      [...ALL_PERMISSION_KEYS].sort(),
    );
  });

  it("a membership cannot reference another tenant's role", async () => {
    // Privileged pool on purpose: RLS is out of the picture — the composite
    // FK must be what rejects the cross-tenant reference, and it must
    // reject with a foreign-key violation (23503), not merely any throw.
    const phone = `f03a-xrole-${RUN}`;
    const uid = uuidv7();
    await admin.query("insert into users (id, phone) values ($1, $2)", [
      uid,
      phone,
    ]);
    cleanupPhones.push(phone);

    const bRoleId = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'coach'",
        [tenantB],
      )
    ).rows[0].id;

    const err = await expectPgError(
      admin.query(
        "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
        [uuidv7(), tenantA, uid, bRoleId],
      ),
    );
    expect(err.code).toBe("23503");
    expect(err.constraint).toBe("tenant_memberships_role_tenant_fkey");
  });

  it("a location-scoped membership does not receive every location", async () => {
    // requireDefaultCtx needs headers() from the request scope; with
    // next/headers and the auth server stubbed at the top of this file it
    // runs end to end here, exercising the real resolveDefaultMembership +
    // resolveLocationIds database path.
    const phone = `f03a-scope-${RUN}`;
    const betterAuthId = `f03a-ba-${RUN}`;
    const uid = uuidv7();
    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [uid, phone, betterAuthId],
    );
    cleanupPhones.push(phone);

    const ownerRole = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'owner'",
        [tenantA],
      )
    ).rows[0].id;

    const locScoped = uuidv7();
    const locOther = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Scoped Hall', true), ($3, $2, 'Other Hall', false)",
      [locScoped, tenantA, locOther],
    );
    cleanupLocationIds.push(locScoped, locOther);

    const mid = uuidv7();
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, false, 'active')",
      [mid, tenantA, uid, ownerRole],
    );
    await admin.query(
      "insert into membership_locations (id, tenant_id, membership_id, location_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantA, mid, locScoped],
    );

    authUser.betterAuthId = betterAuthId;
    const ctx = await requireDefaultCtx();

    expect(ctx.membershipId).toBe(mid);
    expect(ctx.allLocations).toBe(false);
    expect(ctx.locationIds).toEqual([locScoped]);
  });
});
