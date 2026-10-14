import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// Regression evidence for docs/audits/2026-10-09-role-content-permission-audit.md
// A04 (target location ignored) and R04 (unrestricted historical correction).
// The tests call the service the action calls directly, with the same
// authenticated context shape requireDefaultCtx builds; the action's
// requirePermission("staff.attendance") gate is unchanged and not under test.
//
// RED against current HEAD: lib/services/staff-attendance-correction.ts:46-63
// selects the target by tenant/id/deleted state only, and no date window is
// checked anywhere in the service.

type ReviewCtx = ActionCtx & { permissions: Set<string> };

let container: StartedPostgreSqlContainer;
let admin: Pool;
let attendance: typeof import("@/lib/services/staff-attendance-correction");

const tenantId = asTenantId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();
const TIMEZONE = "Asia/Kolkata";
const today = todayInZone(TIMEZONE);
const pastDate = "2020-02-15";

const receptionUserId = asUserId(randomUUID());
const ownerUserId = asUserId(randomUUID());
const emptyActorUserId = asUserId(randomUUID());
const coachAUserId = asUserId(randomUUID());
const coachBUserId = asUserId(randomUUID());
const coachMultiUserId = asUserId(randomUUID());
const coachExtraUserId = asUserId(randomUUID());

const receptionPersonId = randomUUID();
const ownerPersonId = randomUUID();
const emptyActorPersonId = randomUUID();
const coachAPersonId = randomUUID();
const coachBPersonId = randomUUID();
const coachMultiPersonId = randomUUID();
const coachExtraPersonId = randomUUID();
const coachNoLocationPersonId = randomUUID();

const receptionStaffId = randomUUID();
const ownerStaffId = randomUUID();
const emptyActorStaffId = randomUUID();
const coachAStaffId = randomUUID();
const coachBStaffId = randomUUID();
const coachMultiStaffId = randomUUID();
const coachExtraStaffId = randomUUID();
const coachNoLocationStaffId = randomUUID();

const restrictedReception: ReviewCtx = {
  tenantId,
  userId: receptionUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locA],
  permissions: new Set(["staff.attendance", "staff.self"]),
};

const unrestrictedOwner: ReviewCtx = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set(["staff.attendance", "settings.manage", "staff.self"]),
};

const noLocationActor: ReviewCtx = {
  tenantId,
  userId: emptyActorUserId,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [],
  permissions: new Set(["staff.attendance", "staff.self"]),
};

function correction(staffId: string, workDate: string, note: string) {
  return { staffId, workDate, status: "present" as const, note };
}

async function correctionRows(staffId: string, workDate: string) {
  return (
    await admin.query(
      "select id, marked_by, method, note from staff_attendance where tenant_id=$1 and staff_id=$2 and work_date=$3",
      [tenantId, staffId, workDate],
    )
  ).rows;
}

async function correctionAudits(staffId: string, workDate: string) {
  return (
    await admin.query(
      "select actor_id, after->>'note' as note from audit_log where tenant_id=$1 and action='staff.attendance.correct' and after->>'staffId'=$2 and after->>'workDate'=$3",
      [tenantId, staffId, workDate],
    )
  ).rows;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const appPassword = "review-staff-attendance";
  process.env.DATABASE_URL = `postgresql://app_login:${appPassword}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = appPassword;
  const url = container.getConnectionUri();
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, appPassword);
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  const { seedRoleTemplates } = await import("@/lib/services/roles");

  admin = new Pool({ connectionString: url });
  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review attendance authority','active',$3)",
    [tenantId, `review-attendance-${tenantId}`, TIMEZONE],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A site',true),($2,$3,'B site',false)",
    [locA, locB, tenantId],
  );
  await seedRoleTemplates(tenantId);
  const roles = await admin.query<{ id: string; key: string }>(
    "select id, key from roles where tenant_id=$1 and key in ('owner','receptionist','coach')",
    [tenantId],
  );
  const roleId = (key: string) => roles.rows.find((r) => r.key === key)!.id;

  await admin.query(
    "insert into users(id, phone) values ($1,$7),($2,$8),($3,$9),($4,$10),($5,$11),($6,$12)",
    [
      receptionUserId, ownerUserId, emptyActorUserId,
      coachAUserId, coachBUserId, coachMultiUserId,
      "+919810100101", "+919810100102", "+919810100103",
      "+919810100104", "+919810100105", "+919810100106",
    ],
  );
  await admin.query(
    "insert into users(id, phone) values ($1,$2)",
    [coachExtraUserId, "+919810100107"],
  );
  const persons: Array<[string, string]> = [
    [receptionPersonId, "RA Reception"],
    [ownerPersonId, "RA Owner"],
    [emptyActorPersonId, "RA Empty Actor"],
    [coachAPersonId, "RA Coach A"],
    [coachBPersonId, "RA Coach B"],
    [coachMultiPersonId, "RA Coach Multi"],
    [coachExtraPersonId, "RA Coach Extra"],
    [coachNoLocationPersonId, "RA Coach No Location"],
  ];
  for (const [personId, fullName] of persons) {
    await admin.query(
      "insert into persons(id, tenant_id, full_name) values ($1,$2,$3)",
      [personId, tenantId, fullName],
    );
  }
  const staffRows: Array<[string, string, string | null, string]> = [
    [receptionStaffId, receptionPersonId, receptionUserId, "receptionist"],
    [ownerStaffId, ownerPersonId, ownerUserId, "receptionist"],
    [emptyActorStaffId, emptyActorPersonId, emptyActorUserId, "receptionist"],
    [coachAStaffId, coachAPersonId, coachAUserId, "coach"],
    [coachBStaffId, coachBPersonId, coachBUserId, "coach"],
    [coachMultiStaffId, coachMultiPersonId, coachMultiUserId, "coach"],
    [coachExtraStaffId, coachExtraPersonId, coachExtraUserId, "coach"],
    [coachNoLocationStaffId, coachNoLocationPersonId, null, "coach"],
  ];
  for (const [staffId, personId, userId, staffType] of staffRows) {
    await admin.query(
      "insert into staff(id, tenant_id, person_id, user_id, staff_type) values ($1,$2,$3,$4,$5)",
      [staffId, tenantId, personId, userId, staffType],
    );
  }
  const staffLocationRows: Array<[string, string]> = [
    [receptionStaffId, locA],
    [ownerStaffId, locA],
    [coachAStaffId, locA],
    [coachBStaffId, locB],
    [coachMultiStaffId, locA],
    [coachMultiStaffId, locB],
    [coachExtraStaffId, locA],
  ];
  for (const [staffId, locationId] of staffLocationRows) {
    await admin.query(
      "insert into staff_locations(id, tenant_id, staff_id, location_id) values ($1,$2,$3,$4)",
      [randomUUID(), tenantId, staffId, locationId],
    );
  }
  const memberships: Array<{
    userId: string;
    roleKey: string;
    allLocations: boolean;
    locations: string[];
  }> = [
    { userId: receptionUserId, roleKey: "receptionist", allLocations: false, locations: [locA] },
    { userId: ownerUserId, roleKey: "owner", allLocations: true, locations: [] },
    { userId: coachAUserId, roleKey: "coach", allLocations: false, locations: [locA] },
    { userId: coachBUserId, roleKey: "coach", allLocations: false, locations: [locB] },
    { userId: coachMultiUserId, roleKey: "coach", allLocations: false, locations: [locA, locB] },
  ];
  for (const membership of memberships) {
    const membershipId = randomUUID();
    await admin.query(
      "insert into tenant_memberships(id, tenant_id, user_id, role_id, all_locations, status) values ($1,$2,$3,$4,$5,'active')",
      [membershipId, tenantId, membership.userId, roleId(membership.roleKey), membership.allLocations],
    );
    for (const locationId of membership.locations) {
      await admin.query(
        "insert into membership_locations(id, tenant_id, membership_id, location_id) values ($1,$2,$3,$4)",
        [randomUUID(), tenantId, membershipId, locationId],
      );
    }
  }

  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );

  attendance = await import("@/lib/services/staff-attendance-correction");
}, 240_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("review staff attendance correction authority (A04/R04)", () => {
  it("A04 RED: refuses an A-only receptionist correcting a B-only staff target today", async () => {
    const result = await attendance.correctAttendance(
      restrictedReception,
      correction(coachBStaffId, today, "A04 synthetic B-only target"),
    );
    expect(result).toMatchObject({ ok: false });
    expect(await correctionRows(coachBStaffId, today)).toEqual([]);
    expect(await correctionAudits(coachBStaffId, today)).toEqual([]);
  });

  it("A04 RED: fails closed for a restricted caller when the target has no location", async () => {
    const result = await attendance.correctAttendance(
      restrictedReception,
      correction(coachNoLocationStaffId, today, "A04 synthetic no-location target"),
    );
    expect(result).toMatchObject({ ok: false });
    expect(await correctionRows(coachNoLocationStaffId, today)).toEqual([]);
    expect(await correctionAudits(coachNoLocationStaffId, today)).toEqual([]);
  });

  it("A04 RED: fails closed for a caller with no allowed location even on an assigned target", async () => {
    const result = await attendance.correctAttendance(
      noLocationActor,
      correction(coachExtraStaffId, today, "A04 synthetic no-location actor"),
    );
    expect(result).toMatchObject({ ok: false });
    expect(await correctionRows(coachExtraStaffId, today)).toEqual([]);
    expect(await correctionAudits(coachExtraStaffId, today)).toEqual([]);
  });

  it("R04 RED: refuses a receptionist correcting a past date at an allowed site", async () => {
    const result = await attendance.correctAttendance(
      restrictedReception,
      correction(coachAStaffId, pastDate, "R04 synthetic historical correction"),
    );
    expect(result).toMatchObject({ ok: false });
    expect(await correctionRows(coachAStaffId, pastDate)).toEqual([]);
    expect(await correctionAudits(coachAStaffId, pastDate)).toEqual([]);
  });

  it("positive: owner corrects any date with reason; receptionist corrects an allowed-site member today; multi-site target allowed", async () => {
    const ownerResult = await attendance.correctAttendance(
      unrestrictedOwner,
      correction(coachBStaffId, pastDate, "Owner historical correction"),
    );
    expect(ownerResult).toMatchObject({ ok: true });
    expect(await correctionRows(coachBStaffId, pastDate)).toMatchObject([
      { marked_by: ownerStaffId, method: "manual", note: "Owner historical correction" },
    ]);
    expect(await correctionAudits(coachBStaffId, pastDate)).toEqual([
      { actor_id: ownerUserId, note: "Owner historical correction" },
    ]);

    const receptionResult = await attendance.correctAttendance(
      restrictedReception,
      correction(coachAStaffId, today, "Reception today correction"),
    );
    expect(receptionResult).toMatchObject({ ok: true });
    expect(await correctionRows(coachAStaffId, today)).toMatchObject([
      { marked_by: receptionStaffId, method: "manual", note: "Reception today correction" },
    ]);
    expect(await correctionAudits(coachAStaffId, today)).toEqual([
      { actor_id: receptionUserId, note: "Reception today correction" },
    ]);

    const multiResult = await attendance.correctAttendance(
      restrictedReception,
      correction(coachMultiStaffId, today, "Reception multi-site target"),
    );
    expect(multiResult).toMatchObject({ ok: true });
    expect(await correctionRows(coachMultiStaffId, today)).toMatchObject([
      { marked_by: receptionStaffId, note: "Reception multi-site target" },
    ]);
  });

  it("refusals leave no attendance row and no correction audit", async () => {
    const refused: Array<[string, string]> = [
      [coachBStaffId, today],
      [coachNoLocationStaffId, today],
      [coachExtraStaffId, today],
      [coachAStaffId, pastDate],
    ];
    for (const [staffId, workDate] of refused) {
      expect(await correctionRows(staffId, workDate)).toEqual([]);
      expect(await correctionAudits(staffId, workDate)).toEqual([]);
    }
  });
});
