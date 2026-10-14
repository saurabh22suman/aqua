import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

let container: StartedPostgreSqlContainer;
let admin: Pool;
let skillProgress: typeof import("@/lib/services/skill-progress");
let skillFramework: typeof import("@/lib/services/skill-framework");

const tenantId = asTenantId(randomUUID());
const ownerUser = asUserId(randomUUID());
const coachUser = asUserId(randomUUID());
const otherCoachUser = asUserId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();
const coachStaff = randomUUID();
const otherCoachStaff = randomUUID();
const programId = randomUUID();
const batchCoach = randomUUID();
const batchOther = randomUUID();
const frameworkId = randomUUID();
const nodeId = randomUUID();

const assignedMember = asMemberId(randomUUID());
const coachUnassignedMember = asMemberId(randomUUID());
const ownerMember = asMemberId(randomUUID());
const siteBMember = asMemberId(randomUUID());

const ownerCtx: ActionCtx = {
  tenantId,
  userId: ownerUser,
  roleKey: "owner",
  allLocations: true,
  locationIds: [],
};
const coachCtx: ActionCtx = {
  tenantId,
  userId: coachUser,
  roleKey: "coach",
  allLocations: true,
  locationIds: [],
};

function phone(prefix: string): string {
  return `+91${prefix}${String(Date.now()).slice(-7)}`;
}

async function denied(value: unknown): Promise<boolean> {
  try {
    const resolved = await value;
    if (Array.isArray(resolved)) return resolved.length === 0;
    return resolved === null || resolved === undefined;
  } catch {
    return true;
  }
}

async function refused(value: unknown): Promise<boolean> {
  try {
    const result = (await value) as { kind?: string; ok?: boolean };
    if (typeof result?.kind === "string") return result.kind !== "ok";
    if (typeof result?.ok === "boolean") return result.ok === false;
    return false;
  } catch {
    return true;
  }
}

async function assessmentRows(memberId: string): Promise<Array<{ band: number }>> {
  const { rows } = await admin.query<{ band: number }>(
    "select band from assessments where tenant_id=$1 and member_id=$2",
    [tenantId, memberId],
  );
  return rows;
}

async function assessmentAuditCount(memberId: string): Promise<number> {
  const { rows } = await admin.query<{ count: string }>(
    "select count(*)::text as count from audit_log where tenant_id=$1 and action='assessment.record' and after->>'memberId'=$2",
    [tenantId, memberId],
  );
  return Number(rows[0]?.count ?? "0");
}

async function seedMember(id: string, name: string, locationId: string): Promise<void> {
  const personId = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,$3,'1990-01-01')",
    [personId, tenantId, name],
  );
  await admin.query(
    "insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,$5,'active')",
    [id, tenantId, personId, locationId, `AS-${String(id).slice(0, 8)}`],
  );
}

async function seedStaff(id: string, userId: string, name: string): Promise<string> {
  const personId = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,$3,'1990-01-01')",
    [personId, tenantId, name],
  );
  await admin.query(
    "insert into staff(id,tenant_id,person_id,user_id,staff_type) values($1,$2,$3,$4,'coach')",
    [id, tenantId, personId, userId],
  );
  return personId;
}

async function seedEnrolment(memberId: string, batchId: string): Promise<void> {
  await admin.query(
    "insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-09-01')",
    [randomUUID(), tenantId, memberId, batchId],
  );
}

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
  admin = new Pool({ connectionString: url });
  skillProgress = await import("@/lib/services/skill-progress");
  skillFramework = await import("@/lib/services/skill-framework");

  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review assessments','active','Asia/Kolkata')",
    [tenantId, `review-assess-${tenantId}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locA, locB, tenantId],
  );
  await admin.query(
    "insert into users(id,phone) values($1,$4),($2,$5),($3,$6)",
    [ownerUser, coachUser, otherCoachUser, phone("9501"), phone("9502"), phone("9503")],
  );

  await seedStaff(coachStaff, coachUser, "Review Assess Coach");
  await seedStaff(otherCoachStaff, otherCoachUser, "Review Assess Other Coach");

  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'Review assess program')",
    [programId, tenantId],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time,coach_id) values($1,$2,$3,$4,'Coach batch',10,'07:00','08:00',$5)",
    [batchCoach, tenantId, programId, locA, coachStaff],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time,coach_id) values($1,$2,$3,$4,'Other batch',10,'07:00','08:00',$5)",
    [batchOther, tenantId, programId, locA, otherCoachStaff],
  );

  await seedMember(assignedMember, "Assess Assigned", locA);
  await seedMember(coachUnassignedMember, "Assess Unassigned", locA);
  await seedMember(ownerMember, "Assess Owner Member", locA);
  await seedMember(siteBMember, "Assess B Site", locB);

  await seedEnrolment(assignedMember, batchCoach);
  await seedEnrolment(coachUnassignedMember, batchOther);

  await admin.query(
    "insert into skill_frameworks(id,tenant_id,activity_type_key,name) values($1,$2,'swimming','Review ladder')",
    [frameworkId, tenantId],
  );
  await admin.query(
    "insert into skill_nodes(id,tenant_id,framework_id,parent_id,name,ordinal,rubric) values($1,$2,$3,null,'Water confidence',1,'{}'::jsonb)",
    [nodeId, tenantId, frameworkId],
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

describe("review assessment member assignment scope", () => {
  it("hides an unassigned member's progress and history from a coach", async () => {
    expect(
      await denied(skillProgress.getMemberProgress(coachCtx, coachUnassignedMember)),
    ).toBe(true);
    expect(
      await denied(skillProgress.listAssessmentHistory(coachCtx, coachUnassignedMember)),
    ).toBe(true);
  });

  it("refuses a coach assessment for an unassigned member and leaves no row or audit", async () => {
    const result = await skillFramework.recordAssessment(coachCtx, {
      memberId: coachUnassignedMember,
      nodeId,
      band: 3,
      notes: "Should never land",
    });
    expect(await refused(result)).toBe(true);
    expect(await assessmentRows(coachUnassignedMember)).toEqual([]);
    expect(await assessmentAuditCount(coachUnassignedMember)).toBe(0);
  });

  it("lets a coach read and record for a member enrolled in a batch they coach", async () => {
    const progress = await skillProgress.getMemberProgress(coachCtx, assignedMember);
    expect(progress).not.toBeNull();
    const result = await skillFramework.recordAssessment(coachCtx, {
      memberId: assignedMember,
      nodeId,
      band: 2,
      notes: "Assigned learner pass",
    });
    expect(result.ok).toBe(true);
    expect(await assessmentRows(assignedMember)).toEqual([{ band: 2 }]);
    expect(await assessmentAuditCount(assignedMember)).toBe(1);
  });

  it("lets an owner with location access read and record for an unrelated member", async () => {
    const progress = await skillProgress.getMemberProgress(ownerCtx, ownerMember);
    expect(progress).not.toBeNull();
    const result = await skillFramework.recordAssessment(ownerCtx, {
      memberId: ownerMember,
      nodeId,
      band: 4,
    });
    expect(result.ok).toBe(true);
    expect(await assessmentRows(ownerMember)).toEqual([{ band: 4 }]);
    expect(await assessmentAuditCount(ownerMember)).toBe(1);
  });

  it("writes no assessment row and no audit when a coach is refused", async () => {
    const read = await skillProgress.getMemberProgress(coachCtx, siteBMember);
    expect(await denied(read)).toBe(true);
    const result = await skillFramework.recordAssessment(coachCtx, {
      memberId: siteBMember,
      nodeId,
      band: 1,
    });
    expect(await refused(result)).toBe(true);
    expect(await assessmentRows(siteBMember)).toEqual([]);
    expect(await assessmentAuditCount(siteBMember)).toBe(0);
  });
});
