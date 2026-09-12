import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { db } from "@/db/client";

// PR C follow-up — backfill migration for persons + staff rows.
//
// PR C closed the forward path: every new invite now creates
// persons + (where staffType applies) staff rows in the same
// transaction as the membership. But every existing tenant_memberships
// row pre-#122 has a users row with person_id = NULL and no staff
// row. Phase 3.6's audit caught this; the backfill migration in
// db/migrations/20260911120000_invite_persons_staff_backfill.sql
// closes it for existing tenants.
//
// The test seeds a fresh tenant, inserts the pre-fix shape (users
// + memberships, no persons, no staff), runs the migration SQL
// in-process, and asserts:
//   * Every membership now has a persons row keyed at the right
//     (tenant_id, users.person_id) link.
//   * coach + receptionist memberships also have a staff row of
//     the right staff_type; owner / admin / accountant do NOT.
//   * The placeholder fullName is "Role +••• Last4" — a phone-
//     suffixed placeholder, not a real name. The test pins the
//     shape so a future change to the placeholder format is a
//     reviewable diff.
//
// The test runs the migration SQL directly (mirroring the
// approach in tests/tier1/role-permissions-d2-backfill.test.ts)
// rather than spawning pnpm db:migrate, because (a) the test
// must own its tenants' state end-to-end, and (b) re-running
// the full migration ledger mid-test would touch every other
// tenant's data and interfere with parallel tests.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const RUN = Date.now().toString(36);

const tenants: { tenantId: string; slug: string }[] = [];

afterAll(async () => {
  // Wipe ALL prC-backfill* tenants — current run's AND any orphans
  // from prior runs whose cleanup failed. Wipe in FK order.
  const orphanTenants = await admin.query<{ id: string }>(
    "select id from tenants where slug like 'prC-backfill%'",
  );
  for (const { id: tenantId } of orphanTenants.rows) {
    await admin.query("delete from attendance where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from enrolments where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from staff where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
  }
  await admin.query("delete from users where phone like '+91bf%'");
  await admin.query("delete from roles where tenant_id in (select id from tenants where slug like 'prC-backfill%')");
  await admin.query("delete from locations where tenant_id in (select id from tenants where slug like 'prC-backfill%')");
  await admin.query("delete from tenants where slug like 'prC-backfill%'");
  await admin.end();
});

async function seedPreFixTenant(label: string): Promise<string> {
  // Mirror the pre-fix shape: users + memberships only. The seed
  // script never created persons / staff for this tenant, so the
  // users.person_id is NULL and the staff table has no row.
  const tenantId = asTenantId(uuidv7());
  const slug = `prC-backfill-${label}-${RUN}-${uuidv7().slice(0, 8)}`;
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, $3, 'active', 'Asia/Kolkata')",
    [tenantId, slug, `PR C backfill ${label}`],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
    [uuidv7(), tenantId],
  );

  // Memberships for owner, admin, accountant, coach, receptionist.
  // The pre-fix shape — no persons, no staff. Phone is built from
  // the full userId hex (32 chars) so every seed is unique even
  // when tests run in parallel within the same millisecond (UUIDv7
  // time-prefix collisions are common at high concurrency; the
  // earlier 12-char slice flaked in CI).
  for (const r of ["owner", "admin", "accountant", "coach", "receptionist"] as const) {
    const userId = uuidv7();
    const phone = `+91bf${userId.replace(/-/g, "")}`;
    await admin.query(
      "insert into users (id, phone) values ($1, $2)",
      [userId, phone],
    );
    const roleRow = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1::uuid and key = $2",
        [tenantId, r],
      )
    ).rows[0]!;
    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status, all_locations) values ($1, $2, $3, $4, 'active', true)",
      [uuidv7(), tenantId, userId, roleRow.id],
    );
  }

  tenants.push({ tenantId, slug });
  return tenantId;
}

async function personsCount(tenantId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    "select count(*)::text as n from persons where tenant_id = $1::uuid",
    [tenantId],
  );
  return parseInt(r.rows[0]!.n, 10);
}

async function staffCount(tenantId: string, staffType?: string): Promise<number> {
  const r = staffType
    ? await admin.query<{ n: string }>(
        "select count(*)::text as n from staff where tenant_id = $1::uuid and staff_type = $2::text",
        [tenantId, staffType],
      )
    : await admin.query<{ n: string }>(
        "select count(*)::text as n from staff where tenant_id = $1::uuid",
        [tenantId],
      );
  return parseInt(r.rows[0]!.n, 10);
}

async function personsFullNames(tenantId: string): Promise<string[]> {
  const r = await admin.query<{ full_name: string }>(
    "select full_name from persons where tenant_id = $1::uuid order by full_name",
    [tenantId],
  );
  return r.rows.map((row) => row.full_name);
}

describe("PR C backfill migration: db/migrations/20260911120000_invite_persons_staff_backfill.sql", () => {
  it("creates a persons row for every pre-fix membership", async () => {
    const tenantId = await seedPreFixTenant("all-roles");
    expect(await personsCount(tenantId)).toBe(0);
    expect(await staffCount(tenantId)).toBe(0);

    // Apply the migration in-process.
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);

    expect(await personsCount(tenantId)).toBe(5);
  });

  it("the persons placeholder uses 'Role +••• Last4' format (phone-suffixed, not a real name)", async () => {
    const tenantId = await seedPreFixTenant("placeholder");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);
    const names = await personsFullNames(tenantId);
    // Five placeholders, one per membership role.
    expect(names).toHaveLength(5);
    for (const n of names) {
      expect(n).toMatch(/^(owner|admin|accountant|coach|receptionist) \+••• \d{4}$/);
    }
  });

  it("sets users.person_id so the membership links to the persons row", async () => {
    const tenantId = await seedPreFixTenant("user-link");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);
    // Every user in this tenant now has a person_id pointing at
    // a persons row in the same tenant.
    const orphan = await admin.query<{ n: string }>(
      `select count(*)::text as n
         from users u
         join tenant_memberships m on m.user_id = u.id and m.tenant_id = $1::uuid
         where u.person_id is null
           and m.status in ('invited', 'active')
           and m.deleted_at is null`,
      [tenantId],
    );
    expect(parseInt(orphan.rows[0]!.n, 10)).toBe(0);
  });

  it("creates a staff row for coach and receptionist only (not owner / admin / accountant)", async () => {
    const tenantId = await seedPreFixTenant("staff-only");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);

    expect(await staffCount(tenantId, "coach")).toBe(1);
    expect(await staffCount(tenantId, "receptionist")).toBe(1);
    expect(await staffCount(tenantId, "owner")).toBe(0);
    expect(await staffCount(tenantId, "admin")).toBe(0);
    expect(await staffCount(tenantId, "accountant")).toBe(0);
  });

  it("the staff row points at the same users row as the membership (FK to users.user_id)", async () => {
    const tenantId = await seedPreFixTenant("staff-fk");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);

    // Every staff row's user_id matches its tenant_membership's
    // user_id for the same tenant.
    const matches = await admin.query<{ n: string }>(
      `select count(*)::text as n
         from staff s
         join tenant_memberships m
           on m.tenant_id = s.tenant_id
          and m.user_id = s.user_id
         where s.tenant_id = $1::uuid
           and m.deleted_at is null`,
      [tenantId],
    );
    expect(parseInt(matches.rows[0]!.n, 10)).toBe(2); // coach + receptionist
  });

  it("idempotent: running the migration twice produces the same state", async () => {
    const tenantId = await seedPreFixTenant("idempotent");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);
    const before = { persons: await personsCount(tenantId), staff: await staffCount(tenantId) };
    await admin.query(sql);
    const after = { persons: await personsCount(tenantId), staff: await staffCount(tenantId) };
    expect(after).toEqual(before);
  });

  it("post-fix coach can be assigned to a batch (the original audit-gap fix in action)", async () => {
    // Round-trip the audit's exact concern: a coach invited before
    // PR C had no staff row, so batches.coach_id could not point at
    // them. After the backfill, the coach has a staff row, and
    // batches.coach_id resolves cleanly.
    const tenantId = await seedPreFixTenant("batch-assign");
    const sql = readFileSync(
      `${process.cwd()}/db/migrations/20260911120000_invite_persons_staff_backfill.sql`,
      "utf8",
    );
    await admin.query(sql);

    const coachStaffId = (
      await admin.query<{ id: string }>(
        `select s.id
           from staff s
           join users u on u.id = s.user_id
           join tenant_memberships m on m.tenant_id = s.tenant_id and m.user_id = s.user_id
           join roles r on r.id = m.role_id
          where s.tenant_id = $1::uuid
            and r.key = 'coach'
            and m.deleted_at is null`,
        [tenantId],
      )
    ).rows[0]!.id;

    const programId = uuidv7();
    await admin.query(
      "insert into programs (id, tenant_id, name) values ($1, $2, 'BC Program')",
      [programId, tenantId],
    );
    const batchId = uuidv7();
    await admin.query(
      `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, coach_id)
       values ($1, $2, $3, 'BC Batch', 10, '{1,3,5}', '07:00', '08:00', $4)`,
      [batchId, tenantId, programId, coachStaffId],
    );

    const r = await admin.query<{ coach_id: string }>(
      "select coach_id from batches where id = $1::uuid",
      [batchId],
    );
    expect(r.rows[0]!.coach_id).toBe(coachStaffId);
  });

  // Reference unused import to keep the lint pass.
  void db;
});