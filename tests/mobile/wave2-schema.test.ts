import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { asTenantId, asUserId } from "@/lib/ids";

// Wave 2 (docs/role-surfaces-plan.md) — schema + service behaviour for
// members.joined_on, batches.location_id and member_facility_optins,
// plus the facility-aware dashboard breakdown.
//
// Hermetic by construction: a disposable Testcontainer Postgres, the
// real migrations, and the app pool pointed at it (DATABASE_URL set
// before the first service import). This is the tests/migrations/
// fixture pattern, without referencing the privileged migration URL
// from a non-allowlisted file.
//
// All four slices were written red-first in separate files; they are
// consolidated here so the container starts once.

type RegisterModule = typeof import("@/lib/services/register");
type PeopleModule = typeof import("@/lib/services/people");
type ProgramsModule = typeof import("@/lib/services/programs");
type OptinsModule = typeof import("@/lib/services/facility-optins");
type DashboardModule = typeof import("@/lib/services/dashboard");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let register: RegisterModule;
let people: PeopleModule;
let programs: ProgramsModule;
let optins: OptinsModule;
let dashboard: DashboardModule;

const RUN = Date.now().toString(36);
const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const homeA = uuidv7();
const homeB = uuidv7();
const dashA = uuidv7();
const dashB = uuidv7();
const programId = uuidv7();
const TZ = "Asia/Kolkata";

const ctx = { tenantId, userId };

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";
  const appUri = `postgresql://app_login:${encodeURIComponent(appPassword)}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

  // Env before the first lib/env import (bootstrap-roles pulls it in).
  // Only DATABASE_URL and its password cross-check are needed:
  // bootstrapRoles/runMigrations take the privileged URI as an
  // argument, so this file never names the privileged env var (the
  // no-superuser allowlist gate).
  process.env.DATABASE_URL = appUri;
  process.env.APP_LOGIN_PASSWORD = appPassword;

  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(adminUri, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(adminUri);

  register = await import("@/lib/services/register");
  people = await import("@/lib/services/people");
  programs = await import("@/lib/services/programs");
  optins = await import("@/lib/services/facility-optins");
  dashboard = await import("@/lib/services/dashboard");

  admin = new Pool({ connectionString: adminUri });
  // Migrations do not seed the policy version; db/seed-platform.ts does.
  // createMember records a consent that references it.
  await admin.query(
    "insert into policy_versions (version, content) values ('2026.1', 'isolated test policy') on conflict do nothing",
  );
  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'Wave2 Schema', 'active', $3)",
    [tenantId, `wave2-schema-${RUN}`, TZ],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $5, 'Home A', true),
       ($2, $5, 'Home B', false),
       ($3, $5, 'Dash A', false),
       ($4, $5, 'Dash B', false)`,
    [homeA, homeB, dashA, dashB, tenantId],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    userId,
    `+9194${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    "insert into programs (id, tenant_id, name) values ($1, $2, 'Squad')",
    [programId, tenantId],
  );
}, 240_000);

afterAll(async () => {
  if (admin) {
    await admin.query("delete from audit_log where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from attendance where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from sessions where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from batches where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from member_facility_optins where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from consents where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from members where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from programs where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
    await admin.query("delete from users where id = $1::uuid", [userId]);
    await admin.end();
  }
  // Close the app pool before the container stops, or pg emits an
  // unhandled "terminating connection" error on shutdown.
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

async function makeMember(locationId = homeA, joinedOn?: string) {
  const res = await register.createMember(ctx, {
    fullName: `Subject ${uuidv7().slice(-4)}`,
    dateOfBirth: "1990-01-01",
    locationId,
    memberCode: `W2-${uuidv7().slice(-8)}`,
    consents: [
      {
        purpose: "processing",
        policyVersion: "2026.1",
        evidence: { channel: "test" },
      },
    ],
    joinedOn,
  });
  if (!res.ok) throw new Error(res.error);
  return res.memberId;
}

function batchInput(name: string, locationId?: string) {
  return {
    programId,
    name,
    capacity: 10,
    daysOfWeek: [1, 3, 5],
    startTime: "07:00",
    endTime: "08:00",
    locationId,
  };
}

describe("members.joined_on (Wave 2)", () => {
  it("stores an explicit joined date and returns it on list and detail", async () => {
    const memberId = await makeMember(homeA, "2026-08-01");

    const row = (await people.listMembers(ctx, {})).find((r) => r.memberId === memberId);
    expect(row?.joinedOn).toBe("2026-08-01");

    const detail = await people.getMemberDetail(ctx, memberId);
    expect(detail?.joinedOn).toBe("2026-08-01");
  });

  it("defaults to today in the tenant timezone when omitted", async () => {
    const memberId = await makeMember();
    const { todayInZone } = await import("@/lib/time/tz");
    const row = (await people.listMembers(ctx, {})).find((r) => r.memberId === memberId);
    expect(row?.joinedOn).toBe(todayInZone(TZ));
  });

  it("can be corrected through updateMember (backdated admission)", async () => {
    const memberId = await makeMember(homeA, "2026-08-01");
    const res = await people.updateMember(ctx, memberId, {
      fullName: "Backdated Subject",
      dateOfBirth: "1990-01-01",
      locationId: homeA,
      joinedOn: "2026-07-15",
    });
    expect(res.ok).toBe(true);
    const row = (await people.listMembers(ctx, {})).find((r) => r.memberId === memberId);
    expect(row?.joinedOn).toBe("2026-07-15");
  });
});

describe("batches.location_id (Wave 2)", () => {
  it("defaults to the primary facility when omitted", async () => {
    const batch = await programs.createBatch(ctx, batchInput("Default Facility"));
    expect(batch.locationId).toBe(homeA);
    expect(batch.locationName).toBe("Home A");
  });

  it("stores an explicit facility and lists it", async () => {
    const batch = await programs.createBatch(ctx, batchInput("Annex Batch", homeB));
    expect(batch.locationId).toBe(homeB);
    expect(batch.locationName).toBe("Home B");

    const listed = (await programs.listBatches(ctx)).find((b) => b.id === batch.id);
    expect(listed?.locationName).toBe("Home B");
  });

  it("moves a batch between facilities", async () => {
    const batch = await programs.createBatch(ctx, batchInput("Movable", homeA));
    const res = await programs.updateBatch(ctx, {
      batchId: batch.id,
      programId,
      name: "Movable",
      capacity: 10,
      daysOfWeek: [1, 3, 5],
      startTime: "07:00",
      endTime: "08:00",
      locationId: homeB,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.batch.locationName).toBe("Home B");
  });
});

describe("member_facility_optins (Wave 2)", () => {
  it("adds an opt-in and lists it with the facility name", async () => {
    const memberId = await makeMember();
    const res = await optins.addMemberFacility(ctx, {
      memberId,
      locationId: homeB,
      optedOn: "2026-09-01",
    });
    expect(res.ok).toBe(true);

    const opted = await optins.listOptedFacilities(ctx, memberId);
    expect(opted).toHaveLength(1);
    expect(opted[0]!.locationId).toBe(homeB);
    expect(opted[0]!.locationName).toBe("Home B");
    expect(opted[0]!.optedOn).toBe("2026-09-01");
  });

  it("refuses a duplicate active opt-in", async () => {
    const memberId = await makeMember();
    await optins.addMemberFacility(ctx, { memberId, locationId: homeB });
    const duplicate = await optins.addMemberFacility(ctx, { memberId, locationId: homeB });
    expect(duplicate.ok).toBe(false);
  });

  it("includes opted-in members in the facility filter", async () => {
    const memberId = await makeMember();
    expect(
      (await people.listMembers(ctx, { locationId: homeB })).some(
        (m) => m.memberId === memberId,
      ),
    ).toBe(false);

    await optins.addMemberFacility(ctx, { memberId, locationId: homeB });
    expect(
      (await people.listMembers(ctx, { locationId: homeB })).some(
        (m) => m.memberId === memberId,
      ),
    ).toBe(true);
  });

  it("ends an opt-in and removes the member from the facility filter", async () => {
    const memberId = await makeMember();
    const added = await optins.addMemberFacility(ctx, {
      memberId,
      locationId: homeB,
      optedOn: "2026-09-01",
    });
    if (!added.ok) throw new Error(added.error);

    const ended = await optins.endMemberFacility(ctx, {
      optinId: added.row.optinId,
      endedOn: "2026-09-10",
    });
    expect(ended.ok).toBe(true);
    expect(await optins.listOptedFacilities(ctx, memberId)).toHaveLength(0);
    expect(
      (await people.listMembers(ctx, { locationId: homeB })).some(
        (m) => m.memberId === memberId,
      ),
    ).toBe(false);
  });

  it("writes an audit row for add and end", async () => {
    const memberId = await makeMember();
    const added = await optins.addMemberFacility(ctx, {
      memberId,
      locationId: homeB,
    });
    if (!added.ok) throw new Error(added.error);
    await optins.endMemberFacility(ctx, { optinId: added.row.optinId });

    const rows = await admin.query<{ action: string }>(
      "select action from audit_log where tenant_id = $1::uuid and entity_id = $2::uuid order by id",
      [tenantId, added.row.optinId],
    );
    expect(rows.rows.map((r) => r.action)).toEqual([
      "member_facility.add",
      "member_facility.end",
    ]);
  });
});

describe("facility-aware dashboard breakdown (Wave 2)", () => {
  it("counts the member at both home and opted facilities, and attributes attendance to the batch facility", async () => {
    const personId = uuidv7();
    const memberId = uuidv7();
    const batchId = uuidv7();
    const sessionId = uuidv7();

    await admin.query(
      "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Dash Subject', '1990-01-01')",
      [personId, tenantId],
    );
    await admin.query(
      "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
      [memberId, tenantId, personId, dashA, `W2D-${uuidv7().slice(-8)}`],
    );
    await admin.query(
      "insert into member_facility_optins (tenant_id, member_id, location_id, opted_on) values ($1, $2, $3, '2026-09-01')",
      [tenantId, memberId, dashB],
    );
    await admin.query(
      "insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time, location_id) values ($1, $2, $3, 'Dash Squad', 10, '{1,3,5}', '07:00', '08:00', $4)",
      [batchId, tenantId, programId, dashB],
    );
    await admin.query(
      "insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at) values ($1, $2, $3, '2026-09-13', now(), now() + interval '1 hour')",
      [sessionId, tenantId, batchId],
    );
    await admin.query(
      "insert into attendance (id, tenant_id, session_id, member_id, status, client_id, marked_at) values ($1, $2, $3, $4, 'present', $5, now())",
      [uuidv7(), tenantId, sessionId, memberId, `w2d-${uuidv7().slice(-8)}`],
    );

    const data = await dashboard.getOwnerDashboard(ctx);
    const alpha = data.facilityBreakdown.find((r) => r.locationId === dashA);
    const beta = data.facilityBreakdown.find((r) => r.locationId === dashB);

    expect(alpha?.activeMembers).toBe(1);
    expect(beta?.activeMembers).toBe(1);
    expect(beta?.attendancePct).toBe(100);
    expect(alpha?.attendancePct).toBeNull();
  });
});
