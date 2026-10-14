import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asMemberId, asTenantId, asUserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

let container: StartedPostgreSqlContainer;
let admin: Pool;
let makeup: typeof import("@/lib/services/makeup");

const tenantId = asTenantId(randomUUID());
const ownerUser = asUserId(randomUUID());
const coachUser = asUserId(randomUUID());
const receptionUser = asUserId(randomUUID());
const locA = randomUUID();
const locB = randomUUID();
const coachStaff = randomUUID();
const programId = randomUUID();
const batchCoached = randomUUID();
const batchOther = randomUUID();
const batchB = randomUUID();
const sCoachSource = randomUUID();
const sAbsentSource = randomUUID();
const sHiddenSource = randomUUID();
const sSeedSource = randomUUID();
const sTargetA = randomUUID();
const sCancelledA = randomUUID();
const sTargetB = randomUUID();
const sPastTarget = randomUUID();

const assignedMember = asMemberId(randomUUID());
const unassignedMember = asMemberId(randomUUID());
const hiddenMember = asMemberId(randomUUID());
const noAbsenceMember = asMemberId(randomUUID());
const presentMarkMember = asMemberId(randomUUID());
const positiveMember = asMemberId(randomUUID());
const redeemMember = asMemberId(randomUUID());
const missingTargetMember = asMemberId(randomUUID());
const cancelledTargetMember = asMemberId(randomUUID());
const otherSiteTargetMember = asMemberId(randomUUID());
const raceMember = asMemberId(randomUUID());
const pastTargetMember = asMemberId(randomUUID());
const raceGrantMember = asMemberId(randomUUID());

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
const restrictedReceptionCtx: ActionCtx = {
  tenantId,
  userId: receptionUser,
  roleKey: "receptionist",
  allLocations: false,
  locationIds: [locA],
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

async function makeupAuditCount(actorId?: string): Promise<number> {
  const { rows } = actorId
    ? await admin.query<{ count: string }>(
        "select count(*)::text as count from audit_log where tenant_id=$1 and action like 'makeup%' and actor_id=$2",
        [tenantId, actorId],
      )
    : await admin.query<{ count: string }>(
        "select count(*)::text as count from audit_log where tenant_id=$1 and action like 'makeup%'",
        [tenantId],
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
    [id, tenantId, personId, locationId, `MK-${String(id).slice(0, 8)}`],
  );
}

async function seedSession(
  id: string,
  batchId: string,
  locationId: string,
  date: string,
  status = "scheduled",
): Promise<void> {
  await admin.query(
    "insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$6,$7,$8)",
    [id, tenantId, batchId, locationId, date, `${date} 01:30Z`, `${date} 02:30Z`, status],
  );
}

async function seedEnrolment(memberId: string, batchId: string): Promise<void> {
  await admin.query(
    "insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-09-01')",
    [randomUUID(), tenantId, memberId, batchId],
  );
}

async function seedCredit(memberId: string, sourceSessionId: string): Promise<void> {
  await admin.query(
    "insert into makeup_credits(tenant_id,member_id,source_session_id,status,expires_at) values($1,$2,$3,'granted', now() + interval '30 days')",
    [tenantId, memberId, sourceSessionId],
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
  makeup = await import("@/lib/services/makeup");

  await admin.query(
    "insert into tenants(id,slug,name,status,timezone) values($1,$2,'Review makeup','active','Asia/Kolkata')",
    [tenantId, `review-makeup-${tenantId}`],
  );
  await admin.query(
    "insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",
    [locA, locB, tenantId],
  );
  await admin.query(
    "insert into users(id,phone) values($1,$4),($2,$5),($3,$6)",
    [ownerUser, coachUser, receptionUser, phone("9401"), phone("9402"), phone("9403")],
  );

  const coachPerson = randomUUID();
  await admin.query(
    "insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$2,'Review Makeup Coach','1990-01-01')",
    [coachPerson, tenantId],
  );
  await admin.query(
    "insert into staff(id,tenant_id,person_id,user_id,staff_type) values($1,$2,$3,$4,'coach')",
    [coachStaff, tenantId, coachPerson, coachUser],
  );

  await admin.query(
    "insert into programs(id,tenant_id,name) values($1,$2,'Review makeup program')",
    [programId, tenantId],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time,coach_id) values($1,$2,$3,$4,'Coached',10,'07:00','08:00',$5)",
    [batchCoached, tenantId, programId, locA, coachStaff],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$2,$3,$4,'Other',10,'07:00','08:00')",
    [batchOther, tenantId, programId, locA],
  );
  await admin.query(
    "insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$2,$3,$4,'B site',10,'07:00','08:00')",
    [batchB, tenantId, programId, locB],
  );

  await seedSession(sCoachSource, batchCoached, locA, "2026-09-14", "held");
  await seedSession(sAbsentSource, batchOther, locA, "2026-09-15", "held");
  await seedSession(sHiddenSource, batchOther, locA, "2026-09-16", "held");
  await seedSession(sSeedSource, batchOther, locA, "2026-09-17", "held");
  await seedSession(sTargetA, batchOther, locA, "2026-11-10");
  await seedSession(sCancelledA, batchOther, locA, "2026-11-11", "cancelled");
  await seedSession(sTargetB, batchB, locB, "2026-11-12");
  await seedSession(sPastTarget, batchOther, locA, "2020-01-15");

  await seedMember(assignedMember, "Makeup Assigned", locA);
  await seedMember(unassignedMember, "Makeup Unassigned B", locB);
  await seedMember(hiddenMember, "Makeup Hidden", locA);
  await seedMember(noAbsenceMember, "Makeup No Absence", locA);
  await seedMember(presentMarkMember, "Makeup Present Only", locA);
  await seedMember(positiveMember, "Makeup Positive", locA);
  await seedMember(redeemMember, "Makeup Redeem", locA);
  await seedMember(missingTargetMember, "Makeup Missing Target", locA);
  await seedMember(cancelledTargetMember, "Makeup Cancelled Target", locA);
  await seedMember(otherSiteTargetMember, "Makeup B Target", locA);
  await seedMember(raceMember, "Makeup Race", locA);
  await seedMember(pastTargetMember, "Makeup Past Target", locA);
  await seedMember(raceGrantMember, "Makeup Race Grant", locA);

  await seedEnrolment(assignedMember, batchCoached);
  await seedEnrolment(unassignedMember, batchOther);
  await seedEnrolment(hiddenMember, batchOther);
  await seedEnrolment(redeemMember, batchOther);
  await seedEnrolment(missingTargetMember, batchOther);
  await seedEnrolment(cancelledTargetMember, batchOther);
  await seedEnrolment(otherSiteTargetMember, batchOther);
  await seedEnrolment(raceMember, batchOther);
  await seedEnrolment(pastTargetMember, batchOther);

  await admin.query(
    "insert into attendance(id,tenant_id,session_id,member_id,location_id,status,client_id) values($1,$2,$3,$4,$5,'absent',$6)",
    [randomUUID(), tenantId, sAbsentSource, positiveMember, locA, randomUUID()],
  );
  await admin.query(
    "insert into attendance(id,tenant_id,session_id,member_id,location_id,status,client_id) values($1,$2,$3,$4,$5,'present',$6)",
    [randomUUID(), tenantId, sAbsentSource, presentMarkMember, locA, randomUUID()],
  );
  await admin.query(
    "insert into attendance(id,tenant_id,session_id,member_id,location_id,status,client_id) values($1,$2,$3,$4,$5,'absent',$6)",
    [randomUUID(), tenantId, sHiddenSource, hiddenMember, locA, randomUUID()],
  );
  await admin.query(
    "insert into attendance(id,tenant_id,session_id,member_id,location_id,status,client_id) values($1,$2,$3,$4,$5,'absent',$6)",
    [randomUUID(), tenantId, sAbsentSource, raceGrantMember, locA, randomUUID()],
  );

  await admin.query(
    "insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')",
    [randomUUID(), tenantId],
  );

  await seedCredit(hiddenMember, sSeedSource);
  await seedCredit(redeemMember, sSeedSource);
  await seedCredit(missingTargetMember, sSeedSource);
  await seedCredit(cancelledTargetMember, sSeedSource);
  await seedCredit(otherSiteTargetMember, sSeedSource);
  await seedCredit(raceMember, sSeedSource);
  await seedCredit(pastTargetMember, sSeedSource);
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("review makeup authority and resource validation", () => {
  it("refuses a coach grant for an unassigned other-site member with no credit or audit", async () => {
    const before = await makeupAuditCount();
    const result = await makeup.grantMakeupCredit(coachCtx, {
      memberId: unassignedMember,
      sourceSessionId: sCoachSource,
    });
    expect(await refused(result)).toBe(true);
    const credits = await admin.query(
      "select id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, unassignedMember, sCoachSource],
    );
    expect(credits.rows).toEqual([]);
    expect(await makeupAuditCount()).toBe(before);
  });

  it("hides makeup credits, sources and targets from an unassigned coach", async () => {
    expect(await denied(makeup.listMakeupCredits(coachCtx, hiddenMember))).toBe(true);
    expect(await denied(makeup.listMakeupSources(coachCtx, hiddenMember))).toBe(true);
    expect(await denied(makeup.listMakeupTargets(coachCtx, hiddenMember))).toBe(true);
  });

  it("refuses a grant when the source session has no absent attendance row", async () => {
    const result = await makeup.grantMakeupCredit(ownerCtx, {
      memberId: noAbsenceMember,
      sourceSessionId: sAbsentSource,
    });
    expect(await refused(result)).toBe(true);
    const credits = await admin.query(
      "select id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, noAbsenceMember, sAbsentSource],
    );
    expect(credits.rows).toEqual([]);
  });

  it("refuses a grant when the only source mark is present, not absent", async () => {
    const result = await makeup.grantMakeupCredit(ownerCtx, {
      memberId: presentMarkMember,
      sourceSessionId: sAbsentSource,
    });
    expect(await refused(result)).toBe(true);
    const credits = await admin.query(
      "select id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, presentMarkMember, sAbsentSource],
    );
    expect(credits.rows).toEqual([]);
  });

  it("grants for an owner when a real absent mark exists and audits the actor", async () => {
    const result = await makeup.grantMakeupCredit(ownerCtx, {
      memberId: positiveMember,
      sourceSessionId: sAbsentSource,
    });
    expect(result.kind).toBe("ok");
    const credits = await admin.query(
      "select status from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, positiveMember, sAbsentSource],
    );
    expect(credits.rows).toEqual([{ status: "granted" }]);
    expect(await makeupAuditCount(ownerUser)).toBe(1);
  });

  it("lets a restricted receptionist redeem a valid in-location credit and audits the redemption", async () => {
    const result = await makeup.redeemMakeupCredit(restrictedReceptionCtx, {
      memberId: redeemMember,
      sourceSessionId: sSeedSource,
      targetSessionId: sTargetA,
    });
    expect(result.kind).toBe("ok");
    const rows = await admin.query(
      "select status,redeemed_session_id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, redeemMember, sSeedSource],
    );
    expect(rows.rows).toEqual([{ status: "redeemed", redeemed_session_id: sTargetA }]);
    expect(await makeupAuditCount(receptionUser)).toBe(1);
  });

  it("refuses a target session that does not exist", async () => {
    const result = await makeup.redeemMakeupCredit(restrictedReceptionCtx, {
      memberId: missingTargetMember,
      sourceSessionId: sSeedSource,
      targetSessionId: randomUUID(),
    });
    expect(await refused(result)).toBe(true);
    const rows = await admin.query(
      "select status from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, missingTargetMember, sSeedSource],
    );
    expect(rows.rows).toEqual([{ status: "granted" }]);
  });

  it("refuses a cancelled target session", async () => {
    const result = await makeup.redeemMakeupCredit(restrictedReceptionCtx, {
      memberId: cancelledTargetMember,
      sourceSessionId: sSeedSource,
      targetSessionId: sCancelledA,
    });
    expect(await refused(result)).toBe(true);
    const rows = await admin.query(
      "select status from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, cancelledTargetMember, sSeedSource],
    );
    expect(rows.rows).toEqual([{ status: "granted" }]);
  });

  it("refuses a past target session before redeeming", async () => {
    const beforeAudit = await makeupAuditCount(receptionUser);
    const result = await makeup.redeemMakeupCredit(restrictedReceptionCtx, {
      memberId: pastTargetMember,
      sourceSessionId: sSeedSource,
      targetSessionId: sPastTarget,
    });
    expect(await refused(result)).toBe(true);
    if (result.kind === "error") {
      expect(result.code).toBe("target_session_in_past");
    }
    const rows = await admin.query(
      "select status from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, pastTargetMember, sSeedSource],
    );
    expect(rows.rows).toEqual([{ status: "granted" }]);
    expect(await makeupAuditCount(receptionUser)).toBe(beforeAudit);
  });

  it("refuses a target session outside the caller's locations", async () => {
    const result = await makeup.redeemMakeupCredit(restrictedReceptionCtx, {
      memberId: otherSiteTargetMember,
      sourceSessionId: sSeedSource,
      targetSessionId: sTargetB,
    });
    expect(await refused(result)).toBe(true);
    const rows = await admin.query(
      "select status from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
      [tenantId, otherSiteTargetMember, sSeedSource],
    );
    expect(rows.rows).toEqual([{ status: "granted" }]);
  });

  it("serializes concurrent redemption of one credit", async () => {
    const lock = await admin.connect();
    try {
      await lock.query("begin");
      await lock.query(
        "select id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3 for update",
        [tenantId, raceMember, sSeedSource],
      );
      const first = makeup.redeemMakeupCredit(restrictedReceptionCtx, {
        memberId: raceMember,
        sourceSessionId: sSeedSource,
        targetSessionId: sTargetA,
      });
      const second = makeup.redeemMakeupCredit(restrictedReceptionCtx, {
        memberId: raceMember,
        sourceSessionId: sSeedSource,
        targetSessionId: sTargetA,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await lock.query("commit");
      const results = await Promise.allSettled([first, second]);
      const okCount = results.filter(
        (entry) =>
          entry.status === "fulfilled" &&
          (entry.value as { kind: string }).kind === "ok",
      ).length;
      expect(okCount).toBe(1);
    } finally {
      await lock.query("rollback").catch(() => undefined);
      lock.release();
    }
  });

  it("translates a concurrent duplicate grant to already_has_credit, not a raw 23505", async () => {
    const lock = await admin.connect();
    try {
      await lock.query("begin");
      await lock.query(
        "insert into makeup_credits(tenant_id,member_id,source_session_id,status,expires_at) values($1,$2,$3,'granted', now() + interval '30 days')",
        [tenantId, raceGrantMember, sAbsentSource],
      );
      const pending = makeup.grantMakeupCredit(ownerCtx, {
        memberId: raceGrantMember,
        sourceSessionId: sAbsentSource,
      });
      // Let the grant's pre-check pass against the uncommitted state and
      // block on the unique index before the held row commits.
      await new Promise((resolve) => setTimeout(resolve, 500));
      await lock.query("commit");
      const result = await pending;
      expect(result).toMatchObject({
        kind: "error",
        code: "already_has_credit",
      });
      const rows = await admin.query(
        "select id from makeup_credits where tenant_id=$1 and member_id=$2 and source_session_id=$3",
        [tenantId, raceGrantMember, sAbsentSource],
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await lock.query("rollback").catch(() => undefined);
      lock.release();
    }
  });
});
