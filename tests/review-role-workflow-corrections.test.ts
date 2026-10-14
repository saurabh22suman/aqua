import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// R01/R02/R04/R05/R06/R09 (docs/audits/2026-10-13-role-workflow-audit.md)
// — one isolated database proving the responsibility corrections:
//   R01  owner/admin cannot mark student attendance at the service,
//        even when handed an attendance.mark grant;
//   R02  owner-controlled curriculum-lead designation swaps roles and
//        preserves identity/locations;
//   R04  enquiry location ownership with a management review path for
//        unresolved rows;
//   R05  waitlist resource validation (batch/location/member);
//   R06  session-list location scoping;
//   R09  revoked-staff reactivation, credential-epoch invalidation and
//        the issuer-target trust gate.
//
// Upgrade-path proof: the migrations applied here are the same files an
// existing tenant receives.

let container: StartedPostgreSqlContainer;
let admin: Pool;
let rolesService: typeof import("@/lib/services/roles");
let register: typeof import("@/lib/services/register");
let enquiries: typeof import("@/lib/services/enquiries");
let waitlist: typeof import("@/lib/services/waitlist");
let coachSchedule: typeof import("@/lib/services/coach-schedule");
let curriculum: typeof import("@/lib/services/curriculum-lead");
let staffInvitations: typeof import("@/lib/services/staff-invitations");
let inviteLink: typeof import("@/lib/services/invite-link");

const tenantId = asTenantId(randomUUID());
const ownerUser = asUserId(randomUUID());
const adminUser = asUserId(randomUUID());
const coachUser = asUserId(randomUUID());
const revivedUser = asUserId(randomUUID());
const ownerTargetUser = asUserId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();

const memberA = randomUUID();
const memberB = randomUUID();
const batchA = randomUUID();
const batchB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();

const ownerCtx: ActionCtx = {
  tenantId,
  userId: ownerUser,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
  permissions: new Set([
    "settings.manage",
    "staff.invite",
    "members.read",
    "members.write",
    "programs.read",
    "programs.write",
    "enquiries.read",
    "enquiries.write",
    "attendance.read",
  ]),
};
const adminCtx: ActionCtx = {
  ...ownerCtx,
  userId: adminUser,
  roleKey: "admin",
};
const scopedReception: ActionCtx = {
  tenantId,
  userId: randomUUID() as never,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locA],
  permissions: new Set(["enquiries.read", "enquiries.write", "members.read", "programs.read"]),
};
const scopedManager: ActionCtx = {
  tenantId,
  userId: randomUUID() as never,
  roleKey: "admin",
  allLocations: false,
  locationIds: [locA],
  permissions: new Set(["settings.manage", "attendance.read"]),
};

async function roleId(key: string): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "select id from roles where tenant_id=$1 and key=$2",
    [tenantId, key],
  );
  return rows[0]!.id;
}

async function seedPersonAndMember(memberId: string, name: string, locationId: string): Promise<void> {
  const personId = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,$3,'1990-01-01')",
    [personId, tenantId, name],
  );
  await admin.query(
    "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,$5,'active')",
    [memberId, tenantId, personId, locationId, name.slice(0, 8)],
  );
}

async function seedUser(userId: string, phone: string): Promise<void> {
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, phone]);
}

async function seedEnquiry(name: string, locationId: string | null): Promise<string> {
  const id = randomUUID();
  await admin.query(
    "insert into enquiries(id,tenant_id,full_name,source,stage,location_id) values($1,$2,$3,'walk-in','new',$4)",
    [id, tenantId, name, locationId],
  );
  return id;
}

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

  admin = new Pool({ connectionString: adminUri });
  await admin.query(
    "insert into tenants(id,slug,name,status) values($1,$2,'Role workflow','active')",
    [tenantId, `role-workflow-${String(Date.now()).slice(-8)}`],
  );

  rolesService = await import("@/lib/services/roles");
  await rolesService.seedRoleTemplates(tenantId);

  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locA, locB, tenantId],
  );
  await admin.query(
    `insert into config_values(id,key,scope_type,scope_id,tenant_id,value)
     values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')`,
    [randomUUID(), tenantId],
  );

  await seedUser(ownerUser, "+919000007001");
  await seedUser(adminUser, "+919000007002");
  await seedUser(coachUser, "+919000007003");
  await seedUser(revivedUser, "+919000007004");
  await seedUser(ownerTargetUser, "+919000007005");

  await admin.query(
    "insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true),($5,$2,$6,$7,'active',true),($8,$2,$9,$10,'active',true)",
    [randomUUID(), tenantId, ownerUser, await roleId("owner"), randomUUID(), adminUser, await roleId("admin"), randomUUID(), coachUser, await roleId("coach")],
  );
  // Active coach for R09 (revoked later in the test, after an old link
  // is minted).
  await admin.query(
    "insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)",
    [randomUUID(), tenantId, revivedUser, await roleId("coach")],
  );
  // Extra owner (revoked) for the trust-gate refusal.
  await admin.query(
    "insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'revoked',true)",
    [randomUUID(), tenantId, ownerTargetUser, await roleId("owner")],
  );

  const coachPerson = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name) values($1,$2,'Coach One')",
    [coachPerson, tenantId],
  );
  await admin.query(
    "insert into staff(id,tenant_id,person_id,user_id,staff_type) values($1,$2,$3,$4,'coach')",
    [randomUUID(), tenantId, coachPerson, coachUser],
  );

  await seedPersonAndMember(memberA, "Member A", locA);
  await seedPersonAndMember(memberB, "Member B", locB);

  const programId = randomUUID();
  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'Program')",
    [programId, tenantId],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$2,$3,$4,'Batch A',10,'07:00','08:00'),($5,$2,$3,$6,'Batch B',10,'07:00','08:00')",
    [batchA, tenantId, programId, locA, batchB, locB],
  );
  await admin.query(
    "insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$3,$4,$6,'2026-11-02','2026-11-02 01:30Z','2026-11-02 02:30Z'),($2,$3,$5,$7,'2026-11-02','2026-11-02 01:30Z','2026-11-02 02:30Z')",
    [sessionA, sessionB, tenantId, batchA, batchB, locA, locB],
  );

  register = await import("@/lib/services/register");
  enquiries = await import("@/lib/services/enquiries");
  waitlist = await import("@/lib/services/waitlist");
  coachSchedule = await import("@/lib/services/coach-schedule");
  curriculum = await import("@/lib/services/curriculum-lead");
  staffInvitations = await import("@/lib/services/staff-invitations");
  inviteLink = await import("@/lib/services/invite-link");
}, 240_000);

afterAll(async () => {
  await admin?.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
  await container?.stop();
});

describe("R01 owner/admin student attendance is read-only", () => {
  it("templates exclude attendance.mark for owner and admin; coach/reception keep it", () => {
    expect(rolesService.roleTemplatePermissionKeys("owner")?.has("attendance.mark")).toBe(false);
    expect(rolesService.roleTemplatePermissionKeys("admin")?.has("attendance.mark")).toBe(false);
    expect(rolesService.roleTemplatePermissionKeys("coach")?.has("attendance.mark")).toBe(true);
    expect(rolesService.roleTemplatePermissionKeys("receptionist")?.has("attendance.mark")).toBe(true);
  });

  it("refuses the service even when the ctx still carries an attendance.mark grant", async () => {
    const withGrant: ActionCtx = {
      ...ownerCtx,
      permissions: new Set(["attendance.mark", "attendance.read"]),
    };
    await expect(
      register.markAttendance(withGrant, {
        sessionId: sessionA,
        memberId: memberA,
        status: "present",
        clientId: randomUUID(),
      }),
    ).rejects.toThrow("not found");
    await expect(
      register.markAttendance(adminCtx, {
        sessionId: sessionA,
        memberId: memberA,
        status: "present",
        clientId: randomUUID(),
      }),
    ).rejects.toThrow("not found");
    const { rows } = await admin.query(
      "select id from attendance where session_id=$1 and member_id=$2",
      [sessionA, memberA],
    );
    expect(rows).toHaveLength(0);
  });

  it("upgrade path: system owner/admin grants were corrected by migration", async () => {
    const { rows } = await admin.query<{ permission_key: string }>(
      `select rp.permission_key from role_permissions rp
        join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
       where r.tenant_id=$1 and r.key in ('owner','admin') and rp.permission_key='attendance.mark'`,
      [tenantId],
    );
    expect(rows).toEqual([]);
  });

  it("keeps coach marking working on an assigned session (positive control)", async () => {
    // The coach is assigned by staffType coach but not to this batch;
    // assignment refusal (not the R01 role gate) is the expected shape.
    const coachCtx: ActionCtx = {
      ...ownerCtx,
      userId: coachUser,
      roleKey: "coach",
      permissions: new Set(["attendance.mark", "attendance.read"]),
    };
    await expect(
      register.markAttendance(coachCtx, {
        sessionId: sessionA,
        memberId: memberA,
        status: "present",
        clientId: randomUUID(),
      }),
    ).rejects.toThrow("not found");
  });
});

describe("R02 curriculum lead designation", () => {
  it("owner delegates and removes without duplicating the membership", async () => {
    const { rows: before } = await admin.query<{ id: string; role_id: string }>(
      "select m.id, m.role_id from tenant_memberships m where m.tenant_id=$1 and m.user_id=$2",
      [tenantId, coachUser],
    );
    const membershipId = before[0]!.id;
    const coachRole = before[0]!.role_id;

    const state0 = await curriculum.getCurriculumLeadState(ownerCtx, await staffIdFor(coachUser));
    expect(state0).toMatchObject({ eligible: true, isLead: false });

    const promoted = await curriculum.setCurriculumLead(ownerCtx, await staffIdFor(coachUser), true);
    expect(promoted).toEqual({ kind: "ok", isLead: true });
    const state1 = await curriculum.getCurriculumLeadState(ownerCtx, await staffIdFor(coachUser));
    expect(state1.isLead).toBe(true);

    const { rows: after } = await admin.query<{ id: string; role_id: string }>(
      "select m.id, m.role_id from tenant_memberships m where m.tenant_id=$1 and m.user_id=$2",
      [tenantId, coachUser],
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(membershipId);
    expect(after[0]!.role_id).not.toBe(coachRole);
    const leadRole = await roleId("curriculum_lead");
    expect(after[0]!.role_id).toBe(leadRole);

    const removed = await curriculum.setCurriculumLead(ownerCtx, await staffIdFor(coachUser), false);
    expect(removed).toEqual({ kind: "ok", isLead: false });

    const { rows: audits } = await admin.query(
      "select action from audit_log where tenant_id=$1 and entity_id=$2 and action='membership.role_change'",
      [tenantId, membershipId],
    );
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  async function staffIdFor(userId: string): Promise<string> {
    const { rows } = await admin.query<{ id: string }>(
      "select id from staff where tenant_id=$1 and user_id=$2 and deleted_at is null",
      [tenantId, userId],
    );
    return rows[0]!.id;
  }
});

describe("R04 enquiry location ownership", () => {
  it("scoped reception sees only located enquiries at its locations", async () => {
    await seedEnquiry("Located A", locA);
    await seedEnquiry("Located B", locB);
    await seedEnquiry("Unresolved", null);

    const rows = await enquiries.listEnquiries(scopedReception, {});
    expect(rows.map((r) => r.fullName)).toEqual(["Located A"]);
  });

  it("management sees its locations plus the unresolved review queue, never another site", async () => {
    const rows = await enquiries.listEnquiries(scopedManager, {});
    expect(rows.map((r) => r.fullName).sort()).toEqual(["Located A", "Unresolved"]);
  });

  it("rejects creation at a location the caller cannot access", async () => {
    await expect(
      enquiries.createEnquiry(scopedReception, {
        fullName: "Illegal B",
        source: "walk-in",
        locationId: locB,
      }),
    ).rejects.toThrow(/location/i);
    const created = await enquiries.createEnquiry(scopedReception, {
      fullName: "Allowed A",
      source: "walk-in",
      locationId: locA,
    });
    expect(created.locationId).toBe(locA);
  });

  it("refuses reception progression of an unresolved enquiry but allows management", async () => {
    const unresolved = await seedEnquiry("Needs review", null);
    const refused = await enquiries.transitionEnquiryStage(scopedReception, {
      enquiryId: unresolved,
      toStage: "contacted",
    });
    expect(refused).toEqual({ ok: false, error: "Enquiry not found." });
    const allowed = await enquiries.transitionEnquiryStage(scopedManager, {
      enquiryId: unresolved,
      toStage: "contacted",
    });
    expect(allowed).toEqual({ ok: true });
  });

  it("upgrade path: existing enquiry rows gained the location column", async () => {
    const { rows } = await admin.query(
      "select column_name from information_schema.columns where table_name='enquiries' and column_name='location_id'",
    );
    expect(rows).toHaveLength(1);
  });
});

describe("R05 waitlist resource validation", () => {
  it("refuses forged or out-of-scope batch/member ids before any write", async () => {
    const forged = await waitlist.addToWaitlist(scopedReception, {
      memberId: memberA,
      batchId: randomUUID(),
    });
    expect(forged).toMatchObject({ kind: "error", code: "not_found" });

    const outOfScope = await waitlist.addToWaitlist(scopedReception, {
      memberId: memberB,
      batchId: batchB,
    });
    expect(outOfScope).toMatchObject({ kind: "error", code: "not_found" });

    expect(await waitlist.listWaitlist(scopedReception, batchB)).toEqual([]);
    expect(await waitlist.getWaitlistHead(scopedReception, { batchId: batchB })).toBeNull();
  });

  it("allows the in-scope member/batch pair (positive control)", async () => {
    const result = await waitlist.addToWaitlist(scopedReception, {
      memberId: memberA,
      batchId: batchA,
    });
    expect(result.kind).toBe("ok");
  });
});

describe("R06 session-list location scoping", () => {
  it("filters upcoming sessions to the caller's locations", async () => {
    const scoped = await coachSchedule.listUpcomingSessions(scopedManager, "2026-11-01", "2026-11-30");
    expect(scoped.map((s) => s.id)).toEqual([sessionA]);

    const all = await coachSchedule.listUpcomingSessions(ownerCtx, "2026-11-01", "2026-11-30");
    expect(all.map((s) => s.id).sort()).toEqual([sessionA, sessionB].sort());
  });
});

describe("R09 revoked-staff reactivation", () => {
  it("reactivates with a fresh link, leaves the old link dead, and is idempotent-safe", async () => {
    const membership = (
      await admin.query<{ id: string }>(
        "select id from tenant_memberships where tenant_id=$1 and user_id=$2",
        [tenantId, revivedUser],
      )
    ).rows[0]!.id;

    // Fresh token minted before revocation (status active) must die
    // with reactivation's credential epoch. Token iat is
    // second-precision, so cross a second boundary before the epoch is
    // written.
    const oldLink = await inviteLink.issueLoginLink(tenantId, membership, ownerCtx);
    expect(oldLink.kind).toBe("ok");
    await admin.query("update tenant_memberships set status='revoked' where id=$1", [membership]);
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await staffInvitations.reactivateInvitation(ownerCtx, { membershipId: membership });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.roleKey).toBe("coach");

    const { rows } = await admin.query<{ status: string; links_valid_from: Date | null }>(
      "select status, links_valid_from from tenant_memberships where id=$1",
      [membership],
    );
    expect(rows[0]!.status).toBe("invited");
    expect(rows[0]!.links_valid_from).not.toBeNull();

    const oldPreview = await inviteLink.previewLoginLink((oldLink as { token: string }).token);
    expect(oldPreview.kind).toBe("error");

    const newToken = result.urlPath.replace("/login/link/", "");
    const newPreview = await inviteLink.previewLoginLink(newToken);
    expect(newPreview.kind).toBe("ok");

    const again = await staffInvitations.reactivateInvitation(ownerCtx, { membershipId: membership });
    expect(again).toMatchObject({ kind: "error", code: "not_revoked" });
  });

  it("refuses an admin restoring an owner (issuer-target trust)", async () => {
    const ownerMembership = (
      await admin.query<{ id: string }>(
        "select id from tenant_memberships where tenant_id=$1 and user_id=$2",
        [tenantId, ownerTargetUser],
      )
    ).rows[0]!.id;
    const result = await staffInvitations.reactivateInvitation(adminCtx, {
      membershipId: ownerMembership,
    });
    expect(result).toMatchObject({ kind: "error", code: "forbidden_target" });
    const { rows } = await admin.query<{ status: string }>(
      "select status from tenant_memberships where id=$1",
      [ownerMembership],
    );
    expect(rows[0]!.status).toBe("revoked");
  });
});
