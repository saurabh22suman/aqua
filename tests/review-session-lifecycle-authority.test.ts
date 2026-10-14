import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

// A01 regression — session cancel/reschedule lifecycle mutations must
// require management scheduling authority (seeded `programs.write`:
// Owner/Admin only), preserve the authenticated context and enforce
// session location visibility. Attendance permission alone is not
// authority to disrupt another class/site.
// See docs/audits/2026-10-09-role-content-permission-audit.md §A01.

type SessionLifecycle = typeof import("@/lib/services/session-lifecycle");
type CoachSubstitution = typeof import("@/lib/services/coach-substitution");

let container: StartedPostgreSqlContainer;
let admin: Pool;
let lifecycle: SessionLifecycle;
let substitution: CoachSubstitution;

const tenantId = asTenantId(randomUUID());
const ownerUserId = asUserId(randomUUID());
const adminUserId = asUserId(randomUUID());
const coachUserId = asUserId(randomUUID());
const receptionUserId = asUserId(randomUUID());

const locationA = randomUUID();
const locationB = randomUUID();

const ownerCancelTarget = randomUUID();
const ownerRescheduleTarget = randomUUID();
const coachCancelTarget = randomUUID();
const receptionCancelTarget = randomUUID();
const restrictedAdminCancelTarget = randomUUID();
const coachRescheduleTarget = randomUUID();
const restrictedAdminRescheduleTarget = randomUUID();
const restrictedAdminAllowedCancelTarget = randomUUID();
const restrictedAdminAllowedRescheduleTarget = randomUUID();
const restrictedAdminBlockedSubstituteTarget = randomUUID();
const ownerSubstituteTarget = randomUUID();
const substituteCoachStaffId = randomUUID();

const owner = {
  tenantId,
  userId: ownerUserId,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
};
const coach = {
  tenantId,
  userId: coachUserId,
  roleKey: "coach",
  allLocations: false,
  locationIds: [locationA],
};
const reception = {
  tenantId,
  userId: receptionUserId,
  roleKey: "receptionist",
  allLocations: true,
  locationIds: [],
};
const restrictedAdmin = {
  tenantId,
  userId: adminUserId,
  roleKey: "admin",
  allLocations: false,
  locationIds: [locationA],
};

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  process.env.DATABASE_URL = `postgresql://app_login:review-tests@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "review-tests";
  const url = container.getConnectionUri();
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "review-tests");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  const { seedRoleTemplates } = await import("@/lib/services/roles");
  lifecycle = await import("@/lib/services/session-lifecycle");
  substitution = await import("@/lib/services/coach-substitution");

  admin = new Pool({ connectionString: url });
  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review A01','active','Asia/Kolkata')",
    [tenantId, `review-a01-${tenantId}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locationA, locationB, tenantId],
  );
  await seedRoleTemplates(tenantId);
  await admin.query(
    "insert into users(id,phone) values($1,$5),($2,$6),($3,$7),($4,$8)",
    [
      ownerUserId,
      adminUserId,
      coachUserId,
      receptionUserId,
      "+919000007101",
      "+919000007102",
      "+919000007103",
      "+919000007104",
    ],
  );
  const roleRows = await admin.query<{ id: string; key: string }>(
    "select id,key from roles where tenant_id=$1",
    [tenantId],
  );
  const roleId = (key: string) => {
    const row = roleRows.rows.find((r) => r.key === key);
    if (!row) throw new Error(`fixture: seeded role '${key}' missing`);
    return row.id;
  };
  const ownerMembership = randomUUID();
  const adminMembership = randomUUID();
  const coachMembership = randomUUID();
  const receptionMembership = randomUUID();
  await admin.query(
    `insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status) values
       ($1,$5,$6,$10,true,'active'),
       ($2,$5,$7,$11,false,'active'),
       ($3,$5,$8,$12,false,'active'),
       ($4,$5,$9,$13,true,'active')`,
    [
      ownerMembership,
      adminMembership,
      coachMembership,
      receptionMembership,
      tenantId,
      ownerUserId,
      adminUserId,
      coachUserId,
      receptionUserId,
      roleId("owner"),
      roleId("admin"),
      roleId("coach"),
      roleId("receptionist"),
    ],
  );
  await admin.query(
    `insert into membership_locations(id,tenant_id,membership_id,location_id) values
       ($1,$3,$4,$6),($2,$3,$5,$6)`,
    [randomUUID(), randomUUID(), tenantId, adminMembership, coachMembership, locationA],
  );

  const program = randomUUID();
  const batchA = randomUUID();
  const batchB = randomUUID();
  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'Review A01 program')",
    [program, tenantId],
  );
  await admin.query(
    `insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values
       ($1,$3,$4,$5,'A',10,'07:00','08:00'),
       ($2,$3,$4,$6,'B',10,'07:00','08:00')`,
    [batchA, batchB, tenantId, program, locationA, locationB],
  );
  const insertSession = (
    id: string,
    batchId: string,
    locationId: string,
    date: string,
  ) =>
    admin.query(
      `insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at)
       values($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz)`,
      [id, tenantId, batchId, locationId, date, `${date} 01:30Z`, `${date} 02:30Z`],
    );
  await insertSession(ownerCancelTarget, batchA, locationA, "2026-11-02");
  await insertSession(ownerRescheduleTarget, batchA, locationA, "2026-11-03");
  await insertSession(coachCancelTarget, batchB, locationB, "2026-11-02");
  await insertSession(receptionCancelTarget, batchB, locationB, "2026-11-03");
  await insertSession(restrictedAdminCancelTarget, batchB, locationB, "2026-11-04");
  await insertSession(coachRescheduleTarget, batchB, locationB, "2026-11-05");
  await insertSession(restrictedAdminRescheduleTarget, batchB, locationB, "2026-11-06");
  await insertSession(
    restrictedAdminAllowedCancelTarget,
    batchA,
    locationA,
    "2026-11-07",
  );
  await insertSession(
    restrictedAdminAllowedRescheduleTarget,
    batchA,
    locationA,
    "2026-11-08",
  );
  await insertSession(
    restrictedAdminBlockedSubstituteTarget,
    batchB,
    locationB,
    "2026-11-09",
  );
  await insertSession(ownerSubstituteTarget, batchA, locationA, "2026-11-10");

  // A real coach staff row for the substitution paths.
  const substitutePerson = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name) values($1,$2,'Substitute Coach')",
    [substitutePerson, tenantId],
  );
  await admin.query(
    "insert into staff(id,tenant_id,person_id,staff_type) values($1,$2,$3,'coach')",
    [substituteCoachStaffId, tenantId, substitutePerson],
  );

  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

const cancelTargets = [
  coachCancelTarget,
  receptionCancelTarget,
  restrictedAdminCancelTarget,
];
const rescheduleTargets = [
  coachRescheduleTarget,
  restrictedAdminRescheduleTarget,
];

describe("A01 session lifecycle authority", () => {
  it("pins the seeded grant premise: programs.write is Owner/Admin only", async () => {
    const rows = await admin.query<{ key: string }>(
      `select r.key from roles r
         join role_permissions rp on rp.role_id = r.id
        where r.tenant_id = $1 and rp.permission_key = 'programs.write'`,
      [tenantId],
    );
    expect(rows.rows.map((r) => r.key).sort()).toEqual(["admin", "owner"]);
  });

  it("refuses coach, receptionist and restricted-admin cancellation of a B-location session", async () => {
    const before = (
      await admin.query(
        "select * from sessions where id = any($1::uuid[]) order by id",
        [cancelTargets],
      )
    ).rows;

    const coachResult = await lifecycle.cancelSession(coach, coachCancelTarget);
    const receptionResult = await lifecycle.cancelSession(
      reception,
      receptionCancelTarget,
    );
    const adminResult = await lifecycle.cancelSession(
      restrictedAdmin,
      restrictedAdminCancelTarget,
    );

    expect(coachResult).toMatchObject({ kind: "error" });
    expect(receptionResult).toMatchObject({ kind: "error" });
    expect(adminResult).toMatchObject({ kind: "error" });

    const after = (
      await admin.query(
        "select * from sessions where id = any($1::uuid[]) order by id",
        [cancelTargets],
      )
    ).rows;
    expect(after).toEqual(before);

    const audits = await admin.query(
      "select id from audit_log where tenant_id=$1 and entity_id = any($2::uuid[]) and action like 'session.%'",
      [tenantId, cancelTargets],
    );
    expect(audits.rows).toEqual([]);

    const outbox = await admin.query(
      "select id from whatsapp_notification_outbox where tenant_id=$1 and scope_session_id = any($2::uuid[])",
      [tenantId, cancelTargets],
    );
    expect(outbox.rows).toEqual([]);
  });

  it("refuses coach and restricted-admin reschedule of a B-location session", async () => {
    const before = (
      await admin.query(
        "select * from sessions where id = any($1::uuid[]) order by id",
        [rescheduleTargets],
      )
    ).rows;

    const coachResult = await lifecycle.rescheduleSession(coach, {
      sessionId: coachRescheduleTarget,
      newSessionDate: "2026-12-01",
      newStartsAt: new Date("2026-12-01T01:30:00Z"),
      newEndsAt: new Date("2026-12-01T02:30:00Z"),
    });
    const adminResult = await lifecycle.rescheduleSession(restrictedAdmin, {
      sessionId: restrictedAdminRescheduleTarget,
      newSessionDate: "2026-12-02",
      newStartsAt: new Date("2026-12-02T01:30:00Z"),
      newEndsAt: new Date("2026-12-02T02:30:00Z"),
    });

    expect(coachResult).toMatchObject({ kind: "error" });
    expect(adminResult).toMatchObject({ kind: "error" });

    const after = (
      await admin.query(
        "select * from sessions where id = any($1::uuid[]) order by id",
        [rescheduleTargets],
      )
    ).rows;
    expect(after).toEqual(before);

    const audits = await admin.query(
      "select id from audit_log where tenant_id=$1 and entity_id = any($2::uuid[]) and action like 'session.%'",
      [tenantId, rescheduleTargets],
    );
    expect(audits.rows).toEqual([]);
  });

  it("allows a restricted A admin to cancel and reschedule an A-location session", async () => {
    const cancelled = await lifecycle.cancelSession(
      restrictedAdmin,
      restrictedAdminAllowedCancelTarget,
    );
    expect(cancelled).toMatchObject({ kind: "ok", newStatus: "cancelled" });

    const rescheduled = await lifecycle.rescheduleSession(restrictedAdmin, {
      sessionId: restrictedAdminAllowedRescheduleTarget,
      newSessionDate: "2026-12-04",
      newStartsAt: new Date("2026-12-04T01:30:00Z"),
      newEndsAt: new Date("2026-12-04T02:30:00Z"),
    });
    expect(rescheduled).toMatchObject({ kind: "ok", newSessionDate: "2026-12-04" });
  });

  it("refuses a restricted A admin substituting a B-location session, with no change or audit", async () => {
    const before = (
      await admin.query(
        "select * from sessions where id = $1",
        [restrictedAdminBlockedSubstituteTarget],
      )
    ).rows;

    const result = await substitution.substituteCoach(restrictedAdmin, {
      sessionId: restrictedAdminBlockedSubstituteTarget,
      newCoachId: substituteCoachStaffId,
    });
    expect(result).toMatchObject({ kind: "error" });

    const after = (
      await admin.query(
        "select * from sessions where id = $1",
        [restrictedAdminBlockedSubstituteTarget],
      )
    ).rows;
    expect(after).toEqual(before);

    const audits = await admin.query(
      "select id from audit_log where tenant_id=$1 and entity_id=$2 and action='session.substitute'",
      [tenantId, restrictedAdminBlockedSubstituteTarget],
    );
    expect(audits.rows).toEqual([]);
  });

  it("allows an unrestricted owner to substitute a coach, with audit", async () => {
    const result = await substitution.substituteCoach(owner, {
      sessionId: ownerSubstituteTarget,
      newCoachId: substituteCoachStaffId,
    });
    expect(result).toMatchObject({
      kind: "ok",
      newCoachId: substituteCoachStaffId,
      previousCoachId: null,
    });

    const row = await admin.query<{ coach_id: string | null }>(
      "select coach_id from sessions where id=$1",
      [ownerSubstituteTarget],
    );
    expect(row.rows[0]?.coach_id).toBe(substituteCoachStaffId);

    const audits = await admin.query<{ actor_id: string }>(
      "select actor_id from audit_log where tenant_id=$1 and entity_id=$2 and action='session.substitute'",
      [tenantId, ownerSubstituteTarget],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(audits.rows.every((r) => r.actor_id === ownerUserId)).toBe(true);
  });

  it("allows an unrestricted owner to cancel an allowed-location session, with audit", async () => {
    const result = await lifecycle.cancelSession(owner, ownerCancelTarget);
    expect(result).toMatchObject({ kind: "ok", newStatus: "cancelled" });

    const row = await admin.query<{ status: string }>(
      "select status from sessions where id=$1",
      [ownerCancelTarget],
    );
    expect(row.rows[0]?.status).toBe("cancelled");

    const audits = await admin.query<{ actor_id: string }>(
      "select actor_id from audit_log where tenant_id=$1 and entity_id=$2 and action like 'session.cancel%'",
      [tenantId, ownerCancelTarget],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(audits.rows.every((r) => r.actor_id === ownerUserId)).toBe(true);
  });

  it("allows an unrestricted owner to reschedule an allowed-location session, with audit", async () => {
    const result = await lifecycle.rescheduleSession(owner, {
      sessionId: ownerRescheduleTarget,
      newSessionDate: "2026-12-03",
      newStartsAt: new Date("2026-12-03T01:30:00Z"),
      newEndsAt: new Date("2026-12-03T02:30:00Z"),
    });
    expect(result).toMatchObject({
      kind: "ok",
      newSessionDate: "2026-12-03",
    });

    const row = await admin.query<{ session_date: string }>(
      "select session_date::text as session_date from sessions where id=$1",
      [ownerRescheduleTarget],
    );
    expect(row.rows[0]?.session_date).toBe("2026-12-03");

    const audits = await admin.query<{ actor_id: string }>(
      "select actor_id from audit_log where tenant_id=$1 and entity_id=$2 and action like 'session.reschedule%'",
      [tenantId, ownerRescheduleTarget],
    );
    expect(audits.rows.length).toBeGreaterThan(0);
    expect(audits.rows.every((r) => r.actor_id === ownerUserId)).toBe(true);
  });
});
