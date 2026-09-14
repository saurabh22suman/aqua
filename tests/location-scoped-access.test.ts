import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// O-08 (docs/ops-platform-design.md §8) — location-scoped staff access.
// This is an ACCESS-CONTROL boundary inside one business, not tenant
// isolation. The proof: with the key OFF nothing changes; with it ON a
// receptionist attached to one location lists only their members and
// cannot reach another location's member, session or register by id.

type PeopleModule = typeof import("@/lib/services/people");
type RegisterModule = typeof import("@/lib/services/register");
type ConfigAdminModule = typeof import("@/db/config-admin");
type InvitationsModule = typeof import("@/lib/services/staff-invitations");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let people: PeopleModule;
let register: RegisterModule;
let configAdmin: ConfigAdminModule;
let invitations: InvitationsModule;

const tenantId = asTenantId(uuidv7());
const ownerUserId = asUserId(uuidv7());
const receptionUserId = asUserId(uuidv7());
const platformUserId = asUserId(uuidv7());
const ownerMembershipId = uuidv7();
const receptionMembershipId = uuidv7();
const locA = uuidv7();
const locB = uuidv7();
const programId = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();
const sessionA = uuidv7();
const sessionB = uuidv7();
const personA = uuidv7();
const personB = uuidv7();
const memberA = uuidv7();
const memberB = uuidv7();
const DATE = "2026-09-20";
const RUN = Date.now().toString(36);

const KEY = "access.location_scoped_staff" as const;

const scopedReception = {
  tenantId,
  userId: receptionUserId,
  allLocations: false,
  locationIds: [locA],
  roleKey: "receptionist",
};

const ownerCtx = {
  tenantId,
  userId: ownerUserId,
  allLocations: true,
  locationIds: [],
  roleKey: "owner",
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";

  process.env.DATABASE_URL = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(adminUri);
  const { seedRoleTemplates } = await import("@/lib/services/roles");

  people = await import("@/lib/services/people");
  register = await import("@/lib/services/register");
  configAdmin = await import("@/db/config-admin");
  invitations = await import("@/lib/services/staff-invitations");

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants (id, slug, name, status) values ($1, $2, 'O-08 Academy', 'active')",
    [tenantId, `o08-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Worli', true),
       ($2, $3, 'Andheri', false)`,
    [locA, locB, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    `insert into platform_users (id, email, name, password_hash, password_salt, role, status)
     values ($1, $2, 'O-08 Operator', 'h', 's', 'admin', 'active')`,
    [platformUserId, `o08-${RUN}@platform.test`],
  );
  await admin.query(
    "insert into users (id, phone) values ($1, $2), ($3, $4)",
    [
      ownerUserId,
      `+9194${String(Date.now()).slice(-8)}1`,
      receptionUserId,
      `+9194${String(Date.now()).slice(-8)}2`,
    ],
  );
  const roles = await admin.query<{ id: string; key: string }>(
    "select id, key from roles where tenant_id = $1 and key in ('owner','receptionist')",
    [tenantId],
  );
  const ownerRoleId = roles.rows.find((r) => r.key === "owner")!.id;
  const receptionRoleId = roles.rows.find((r) => r.key === "receptionist")!.id;

  await admin.query(
    `insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status)
     values ($1, $3, $4, $6, true, 'active'),
            ($2, $3, $5, $7, false, 'active')`,
    [
      ownerMembershipId,
      receptionMembershipId,
      tenantId,
      ownerUserId,
      receptionUserId,
      ownerRoleId,
      receptionRoleId,
    ],
  );
  await admin.query(
    `insert into membership_locations (id, tenant_id, membership_id, location_id)
     values ($4, $1, $2, $3)`,
    [tenantId, receptionMembershipId, locA, uuidv7()],
  );

  await admin.query(
    `insert into persons (id, tenant_id, full_name) values
       ($1, $3, 'Worli Member'), ($2, $3, 'Andheri Member')`,
    [personA, personB, tenantId],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, status, member_code) values
       ($1, $3, $5, $7, 'active', $9),
       ($2, $4, $6, $8, 'active', $10)`,
    [
      memberA,
      memberB,
      tenantId,
      tenantId,
      personA,
      personB,
      locA,
      locB,
      `O08-A-${RUN}`,
      `O08-B-${RUN}`,
    ],
  );
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenantId],
  );
  await admin.query(
    `insert into batches (id, tenant_id, program_id, location_id, name, capacity, days_of_week, start_time, end_time) values
       ($1, $3, $5, $6, 'Worli Squad', 10, '{1}', '07:00', '08:00'),
       ($2, $4, $5, $7, 'Andheri Squad', 10, '{1}', '09:00', '10:00')`,
    [batchA, batchB, tenantId, tenantId, programId, locA, locB],
  );
  await admin.query(
    `insert into sessions (id, tenant_id, batch_id, location_id, session_date, starts_at, ends_at, status) values
       ($1, $3, $5, $7, $9::date, $9::timestamptz + interval '7 hours', $9::timestamptz + interval '8 hours', 'held'),
       ($2, $4, $6, $8, $9::date, $9::timestamptz + interval '9 hours', $9::timestamptz + interval '10 hours', 'held')`,
    [sessionA, sessionB, tenantId, tenantId, batchA, batchB, locA, locB, DATE],
  );
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("O-08 location-scoped staff access", () => {
  it("changes nothing while the key is off (default)", async () => {
    const members = await people.listMembers(scopedReception, {});
    expect(members).toHaveLength(2);
    expect(await people.getMemberDetail(scopedReception, memberB)).not.toBeNull();

    const sessions = await register.listTodaySessions(scopedReception, DATE);
    expect(sessions).toHaveLength(2);
  });

  it("scopes lists and by-id paths when the key is on", async () => {
    // Production path: ops enables the key (it is owner_read, so the
    // owner path rejects it by design — see O-07).
    const enabled = await configAdmin.setPlatformTenantConfigValue({
      tenantId,
      key: KEY,
      value: true,
      actorId: platformUserId,
    });
    expect(enabled.ok).toBe(true);

    const members = await people.listMembers(scopedReception, {});
    expect(members.map((m) => m.memberId)).toEqual([memberA]);
    expect(await people.getMemberDetail(scopedReception, memberA)).not.toBeNull();
    expect(await people.getMemberDetail(scopedReception, memberB)).toBeNull();

    const sessions = await register.listTodaySessions(scopedReception, DATE);
    expect(sessions.map((s) => s.id)).toEqual([sessionA]);
    expect(await register.sessionVisibleToCaller(scopedReception, sessionA)).toBe(true);
    expect(await register.sessionVisibleToCaller(scopedReception, sessionB)).toBe(false);
    expect(await register.getRosterForSession(scopedReception, sessionB)).toBeNull();
    expect(await register.getRosterForSession(scopedReception, sessionA)).not.toBeNull();
  });

  it("refuses writes into another location", async () => {
    const updateOther = await people.updateMember(scopedReception, memberB, {
      fullName: "Andheri Member",
      dateOfBirth: "1990-01-01",
      locationId: locB,
    });
    expect(updateOther.ok).toBe(false);

    const moveOut = await people.updateMember(scopedReception, memberA, {
      fullName: "Worli Member",
      dateOfBirth: "1990-01-01",
      locationId: locB,
    });
    expect(moveOut.ok).toBe(false);

    await expect(
      register.markAttendance(scopedReception, {
        sessionId: sessionB,
        memberId: memberB,
        status: "present",
        clientId: `o08-${RUN}-b`,
      }),
    ).rejects.toThrow();

    expect(
      await register.countAttendanceForSession(scopedReception, sessionB),
    ).toBe(0);

    const enrol = await register.enrolMember(scopedReception, {
      memberId: memberA,
      batchId: batchB,
    });
    expect(enrol.ok).toBe(false);

    const createAtOther = await register.createMember(scopedReception, {
      fullName: "New Andheri Member",
      dateOfBirth: "1990-01-01",
      locationId: locB,
      memberCode: `O08-NEW-${RUN}`,
      consents: [],
    });
    expect(createAtOther.ok).toBe(false);
  });

  it("still allows the in-scope write paths", async () => {
    await register.markAttendance(scopedReception, {
      sessionId: sessionA,
      memberId: memberA,
      status: "present",
      clientId: `o08-${RUN}-a`,
    });
    expect(await register.countAttendanceForSession(scopedReception, sessionA)).toBe(1);
  });

  it("keeps an all-locations caller unrestricted", async () => {
    const members = await people.listMembers(ownerCtx, {});
    expect(members).toHaveLength(2);
    expect(await people.getMemberDetail(ownerCtx, memberB)).not.toBeNull();
  });

  it("mirrors invite locations onto the staff record for worker/accountant", async () => {
    const result = await invitations.inviteStaff(ownerCtx, {
      phone: `+9197${String(Date.now()).slice(-8)}`,
      fullName: "Worker One",
      roleKey: "worker",
      locationIds: [locA],
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const staff = await admin.query<{ id: string; staff_type: string }>(
      "select id, staff_type from staff where tenant_id = $1 and user_id = $2",
      [tenantId, result.userId],
    );
    expect(staff.rows).toHaveLength(1);
    expect(staff.rows[0].staff_type).toBe("worker");

    const links = await admin.query<{ location_id: string }>(
      "select location_id from staff_locations where tenant_id = $1 and staff_id = $2",
      [tenantId, staff.rows[0].id],
    );
    expect(links.rows.map((r) => r.location_id)).toEqual([locA]);
  });

  it("restores tenant-wide visibility when the key is turned off", async () => {
    const disabled = await configAdmin.setPlatformTenantConfigValue({
      tenantId,
      key: KEY,
      value: false,
      actorId: platformUserId,
    });
    expect(disabled.ok).toBe(true);
    const members = await people.listMembers(scopedReception, {});
    expect(members).toHaveLength(2);
  });
});
