import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";

// D2 follow-up — role_permissions backfill migration.
//
// Context: PR D2 split `members.read` into a full-roster grant
// (`members.read` — owner/admin/receptionist) and a coach-only
// grant (`members.read.assigned`). It also introduced
// `dashboard.view` (owner/admin only). The audit closed three
// attacks: dashboard now requires dashboard.view; coach no
// longer holds members.read (the direct-POST leak); coach's
// roster reads use members.read.assigned.
//
// All three are dependent on `role_permissions` rows that exist
// in every tenant. PR D2 updated lib/services/roles.ts's
// ROLE_TEMPLATES so freshly-seeded tenants are correct. Existing
// tenants — the audit's actual concern — were seeded before D2
// and have the OLD shape:
//   * coach rows have members.read, no members.read.assigned
//   * owner + admin rows are missing dashboard.view
//   * receptionist rows are correct already
//
// db/migrations/20260911110000_role_permissions_d2_backfill.sql
// is the fix: grant dashboard.view to owner + admin, grant
// members.read.assigned to coach, revoke members.read from
// coach. Idempotent (on conflict do nothing for grants; the
// revoke is naturally idempotent — a no-op delete on an already-
// empty set).

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

const tenants: { tenantId: string; slug: string }[] = [];

afterAll(async () => {
  for (const { tenantId, slug } of tenants) {
    await admin.query("delete from role_permissions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
    void slug;
  }
  await admin.end();
});

async function seedPreFixTenant(label: string): Promise<string> {
  // Fresh tenant. seedRoleTemplates writes the post-D2 shape
  // (with dashboard.view + members.read.assigned on owner/admin/
  // coach respectively). To simulate the pre-D2 state the
  // migration is meant to repair, delete those two new grants
  // AND re-add members.read to coach immediately after seeding.
  // The resulting role_permissions set is exactly what existing
  // tenants in production look like right now: coach holds
  // members.read but not members.read.assigned, owner + admin
  // lack dashboard.view, receptionist has members.read (already
  // correct pre- and post-fix).
  const tenantId = asTenantId(uuidv7());
  const slug = `prD2-backfill-${label}-${RUN}-${uuidv7().slice(0, 8)}`;
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', 'Asia/Kolkata')",
    [tenantId, slug, `PR D2 backfill ${label}`],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), tenantId],
  );

  // Strip the D2-era grants to simulate pre-fix state.
  await admin.query(
    `delete from role_permissions rp
       using roles r
       where rp.role_id = r.id
         and r.tenant_id = $1::uuid
         and rp.permission_key in ('dashboard.view', 'members.read.assigned')`,
    [tenantId],
  );
  // Re-add members.read to coach (pre-fix shape).
  await admin.query(
    `insert into role_permissions (tenant_id, role_id, permission_key)
     select r.tenant_id, r.id, 'members.read'
       from roles r
       where r.tenant_id = $1::uuid and r.key = 'coach'
     on conflict do nothing`,
    [tenantId],
  );

  tenants.push({ tenantId, slug });
  return tenantId;
}

async function hasGrant(tenantId: string, roleKey: string, permKey: string): Promise<boolean> {
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

describe("D2 backfill migration: db/migrations/20260911110000_role_permissions_d2_backfill.sql", () => {
  it("grants dashboard.view to owner and admin in a pre-fix tenant", async () => {
    const tenantId = await seedPreFixTenant("owner-admin");
    expect(await hasGrant(tenantId, "owner", "dashboard.view")).toBe(false);
    expect(await hasGrant(tenantId, "admin", "dashboard.view")).toBe(false);

    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'dashboard.view' from roles r where r.key in ('owner', 'admin') on conflict do nothing",
    );

    expect(await hasGrant(tenantId, "owner", "dashboard.view")).toBe(true);
    expect(await hasGrant(tenantId, "admin", "dashboard.view")).toBe(true);
  });

  it("grants members.read.assigned to coach in a pre-fix tenant", async () => {
    const tenantId = await seedPreFixTenant("coach-assigned");
    expect(await hasGrant(tenantId, "coach", "members.read.assigned")).toBe(false);

    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'members.read.assigned' from roles r where r.key = 'coach' on conflict do nothing",
    );

    expect(await hasGrant(tenantId, "coach", "members.read.assigned")).toBe(true);
  });

  it("revokes members.read from coach (the audit-leak fix)", async () => {
    const tenantId = await seedPreFixTenant("coach-revoke");
    // Confirm pre-fix: coach has members.read.
    expect(await hasGrant(tenantId, "coach", "members.read")).toBe(true);

    await admin.query(
      `delete from role_permissions rp
         using roles r
         where rp.role_id = r.id
           and r.key = 'coach'
           and rp.permission_key = 'members.read'`,
    );

    expect(await hasGrant(tenantId, "coach", "members.read")).toBe(false);
    // Other roles keep members.read — receptionist is the canary.
    expect(await hasGrant(tenantId, "receptionist", "members.read")).toBe(true);
    expect(await hasGrant(tenantId, "owner", "members.read")).toBe(true);
    expect(await hasGrant(tenantId, "admin", "members.read")).toBe(true);
  });

  it("idempotent: running the migration twice produces the same state", async () => {
    const tenantId = await seedPreFixTenant("idempotent");
    // Apply once.
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'dashboard.view' from roles r where r.key in ('owner', 'admin') on conflict do nothing",
    );
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'members.read.assigned' from roles r where r.key = 'coach' on conflict do nothing",
    );
    await admin.query(
      `delete from role_permissions rp
         using roles r
         where rp.role_id = r.id and r.key = 'coach' and rp.permission_key = 'members.read'`,
    );
    const stateAfterFirst = {
      ownerDashView: await hasGrant(tenantId, "owner", "dashboard.view"),
      adminDashView: await hasGrant(tenantId, "admin", "dashboard.view"),
      coachAssigned: await hasGrant(tenantId, "coach", "members.read.assigned"),
      coachRead: await hasGrant(tenantId, "coach", "members.read"),
    };
    // Apply again.
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'dashboard.view' from roles r where r.key in ('owner', 'admin') on conflict do nothing",
    );
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'members.read.assigned' from roles r where r.key = 'coach' on conflict do nothing",
    );
    await admin.query(
      `delete from role_permissions rp
         using roles r
         where rp.role_id = r.id and r.key = 'coach' and rp.permission_key = 'members.read'`,
    );
    const stateAfterSecond = {
      ownerDashView: await hasGrant(tenantId, "owner", "dashboard.view"),
      adminDashView: await hasGrant(tenantId, "admin", "dashboard.view"),
      coachAssigned: await hasGrant(tenantId, "coach", "members.read.assigned"),
      coachRead: await hasGrant(tenantId, "coach", "members.read"),
    };
    expect(stateAfterSecond).toEqual(stateAfterFirst);
  });

  it("preserves per-tenant customisations: a renamed role key is untouched", async () => {
    // An operator renamed 'coach' to 'head-coach' in this tenant
    // (a deliberate customisation; the audit would still
    // recognise this role as coach-like). The backfill must not
    // touch it — it filters on role.key = 'coach', which the
    // renamed role no longer matches.
    const tenantId = await seedPreFixTenant("customised");
    await admin.query(
      "update roles set key = 'head-coach' where tenant_id = $1::uuid and key = 'coach'",
      [tenantId],
    );

    // Apply the migration.
    await admin.query(
      `delete from role_permissions rp
         using roles r
         where rp.role_id = r.id and r.key = 'coach' and rp.permission_key = 'members.read'`,
    );

    // The renamed role still has members.read — only role.key='coach'
    // matches, and that key no longer exists in this tenant.
    const renamedGrants = await admin.query<{ permission_key: string }>(
      `select rp.permission_key
         from role_permissions rp
         join roles r on r.id = rp.role_id
         where r.tenant_id = $1::uuid and r.key = 'head-coach'`,
      [tenantId],
    );
    expect(renamedGrants.rows.map((r) => r.permission_key)).toContain("members.read");
  });

  it("full end-to-end: pre-fix state → migration → post-fix state for every role", async () => {
    const tenantId = await seedPreFixTenant("end-to-end");

    // Sanity-check pre-fix state.
    expect(await hasGrant(tenantId, "owner", "dashboard.view")).toBe(false);
    expect(await hasGrant(tenantId, "admin", "dashboard.view")).toBe(false);
    expect(await hasGrant(tenantId, "coach", "members.read.assigned")).toBe(false);
    expect(await hasGrant(tenantId, "coach", "members.read")).toBe(true);

    // Apply the migration: this is the same SQL the migration
    // file ships, executed in the test against the live DB.
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'dashboard.view' from roles r where r.key in ('owner', 'admin') on conflict do nothing",
    );
    await admin.query(
      "insert into role_permissions (tenant_id, role_id, permission_key) select r.tenant_id, r.id, 'members.read.assigned' from roles r where r.key = 'coach' on conflict do nothing",
    );
    await admin.query(
      `delete from role_permissions rp
         using roles r
         where rp.role_id = r.id and r.key = 'coach' and rp.permission_key = 'members.read'`,
    );

    // Post-fix state.
    expect(await hasGrant(tenantId, "owner", "dashboard.view")).toBe(true);
    expect(await hasGrant(tenantId, "admin", "dashboard.view")).toBe(true);
    expect(await hasGrant(tenantId, "coach", "members.read.assigned")).toBe(true);
    expect(await hasGrant(tenantId, "coach", "members.read")).toBe(false);
    // receptionist untouched — already correct.
    expect(await hasGrant(tenantId, "receptionist", "members.read")).toBe(true);
  });
});