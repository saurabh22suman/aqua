import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

let container: StartedPostgreSqlContainer;
let admin: Pool;
let register: typeof import("@/lib/services/register");
let history: typeof import("@/lib/services/attendance-history");
let enrolment: typeof import("@/lib/services/enrolment");
let status: typeof import("@/lib/services/member-status");
let transfer: typeof import("@/lib/services/transfer");
const tenantId = asTenantId(randomUUID());
const userId = asUserId(randomUUID());
const locationA = randomUUID(), locationB = randomUUID();
const memberA = randomUUID(), memberB = randomUUID(), missingMember = randomUUID();
const batchA = randomUUID(), batchB = randomUUID(), fullBatch = randomUUID();
const sessionA = randomUUID(), sessionB = randomUUID();
const sourceId = randomUUID();
const scoped = { tenantId, userId, roleKey: "receptionist", allLocations: false, locationIds: [locationA] };
const owner = { tenantId, userId, roleKey: "owner", allLocations: true, locationIds: [] };
// R01 — student attendance is marked by coach/reception, not owner.
// The integration seeding below uses a reception-shaped context; the
// owner-read-only behaviour is pinned in
// tests/review-role-workflow-corrections.test.ts (R01).
const marker = { tenantId, userId, roleKey: "receptionist", allLocations: true, locationIds: [] };

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
  await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Review resources','active')", [tenantId, `review-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,'+919000006001')", [userId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)", [locationA, locationB, tenantId]);
  const personA = randomUUID(), personB = randomUUID();
  await admin.query("insert into persons(id,tenant_id,full_name,date_of_birth) values($1,$3,'Synthetic A','1990-01-01'),($2,$3,'Synthetic B','1990-01-01')", [personA, personB, tenantId]);
  await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$3,$4,$6,'A','active'),($2,$3,$5,$7,'B','active')", [memberA, memberB, tenantId, personA, personB, locationA, locationB]);
  const program = randomUUID();
  await admin.query("insert into programs(id,tenant_id,name) values($1,$2,'Review program')", [program, tenantId]);
  await admin.query("insert into batches(id,tenant_id,program_id,location_id,name,capacity,start_time,end_time) values($1,$4,$5,$6,'A',10,'07:00','08:00'),($2,$4,$5,$7,'B',10,'07:00','08:00'),($3,$4,$5,$6,'Full',1,'08:00','09:00')", [batchA, batchB, fullBatch, tenantId, program, locationA, locationB]);
  await admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$3,$4,$6,'2026-10-01','2026-10-01 01:30Z','2026-10-01 02:30Z'),($2,$3,$5,$7,'2026-10-01','2026-10-01 01:30Z','2026-10-01 02:30Z')", [sessionA, sessionB, tenantId, batchA, batchB, locationA, locationB]);
  await admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$5,'2026-09-01'),($7,$2,$4,$6,'2026-09-01'),($8,$2,$4,$9,'2026-09-01')", [sourceId, tenantId, memberA, memberB, batchA, batchB, randomUUID(), randomUUID(), fullBatch]);
  await admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true')", [randomUUID(), tenantId]);
  register = await import("@/lib/services/register");
  history = await import("@/lib/services/attendance-history");
  enrolment = await import("@/lib/services/enrolment");
  status = await import("@/lib/services/member-status");
  transfer = await import("@/lib/services/transfer");
}, 120_000);

afterAll(async () => {
  await (await import("@/db/client")).pool.end();
  await admin?.end();
  await container?.stop();
});

describe("review resource and roster closure", () => {
  it("refuses another site's member, destination and status mutation", async () => {
    expect((await register.enrolMember(scoped, { memberId: memberB, batchId: batchA })).ok).toBe(false);
    expect((await register.enrolMember(scoped, { memberId: memberA, batchId: batchB })).ok).toBe(false);
    expect((await status.pauseMember(scoped, memberB, "Synthetic reason")).ok).toBe(false);
    expect((await transfer.transferMemberToBatch(scoped, { memberId: memberA, fromBatchId: batchA, toBatchId: batchB })).kind).toBe("error");
    expect((await admin.query("select status from members where id=$1", [memberB])).rows[0].status).toBe("active");
  });

  it("hides other-site attendance and enrolment histories", async () => {
    await register.markAttendance(marker, { sessionId: sessionB, memberId: memberB, status: "present", clientId: randomUUID() });
    expect((await history.getMemberAttendanceHistory(scoped, memberB, { from: "2026-09-01", to: "2026-11-01" })).rows).toEqual([]);
    expect(await history.getBatchAttendanceSummary(scoped, batchB, { from: "2026-09-01", to: "2026-11-01" })).toBeNull();
    expect(await enrolment.listMemberEnrolments(scoped, memberB)).toEqual([]);
    expect((await history.getMemberAttendanceHistory(owner, memberB, { from: "2026-09-01", to: "2026-11-01" })).rows).toHaveLength(1);
    const unassignedCoach = { ...owner, roleKey: "coach" };
    expect((await history.getMemberAttendanceHistory(unassignedCoach, memberB, { from: "2026-09-01", to: "2026-11-01" })).rows).toEqual([]);
    expect(await history.getBatchAttendanceSummary(unassignedCoach, batchB, { from: "2026-09-01", to: "2026-11-01" })).toBeNull();
  });

  it("rejects a non-roster member, future enrolment, inactive member and cancelled session", async () => {
    const mark = (memberId: string) => register.markAttendance(marker, { sessionId: sessionA, memberId, status: "present", clientId: randomUUID() });
    await expect(mark(memberB)).rejects.toThrow("not found");
    await expect(mark(missingMember)).rejects.toThrow("not found");
    await admin.query("update enrolments set enrolled_on='2026-10-02' where id=$1", [sourceId]);
    await expect(mark(memberA)).rejects.toThrow("not found");
    await admin.query("update enrolments set enrolled_on='2026-09-01' where id=$1", [sourceId]);
    await admin.query("update members set status='paused' where id=$1", [memberA]);
    await expect(mark(memberA)).rejects.toThrow("not found");
    await admin.query("update members set status='active' where id=$1", [memberA]);
    await admin.query("update sessions set status='cancelled' where id=$1", [sessionA]);
    await expect(mark(memberA)).rejects.toThrow("not found");
    await admin.query("update sessions set status='scheduled' where id=$1", [sessionA]);
    expect((await admin.query("select id from attendance where session_id=$1", [sessionA])).rows).toHaveLength(0);
  });

  it("attributes and atomically audits legitimate marks without auditing identical replay twice", async () => {
    const input = { sessionId: sessionA, memberId: memberA, status: "late" as const, clientId: randomUUID() };
    await register.markAttendance(scoped, input);
    await register.markAttendance(scoped, input);
    const rows = await admin.query("select id,marked_by from attendance where session_id=$1", [sessionA]);
    expect(rows.rows[0].marked_by).toBe(userId);
    const audits = await admin.query("select actor_id from audit_log where entity_id=$1 and action='attendance.mark'", [rows.rows[0].id]);
    expect(audits.rows).toEqual([{ actor_id: userId }]);
  });

  it("keeps refused transfers byte-identical and writes no transfer audit", async () => {
    const before = (await admin.query("select * from enrolments where id=$1", [sourceId])).rows;
    const result = await transfer.transferMemberToBatch(owner, { memberId: memberA, fromBatchId: batchA, toBatchId: fullBatch });
    expect(result).toMatchObject({ kind: "error", code: "target_full" });
    expect((await admin.query("select * from enrolments where id=$1", [sourceId])).rows).toEqual(before);
    expect((await admin.query("select id from audit_log where tenant_id=$1 and action='member.transfer'", [tenantId])).rows).toEqual([]);
  });

  it("rolls a mark back when its audit cannot be written", async () => {
    await admin.query("create function review_reject_audit() returns trigger language plpgsql as $$ begin if new.action='attendance.mark' then raise exception 'review audit failure'; end if; return new; end $$");
    await admin.query("create trigger review_reject_audit before insert on audit_log for each row execute function review_reject_audit()");
    try {
      await expect(register.markAttendance(scoped, { sessionId: sessionA, memberId: memberA, status: "absent", clientId: randomUUID() })).rejects.toThrow();
      expect((await admin.query("select status from attendance where session_id=$1", [sessionA])).rows[0].status).toBe("late");
    } finally { await admin.query("drop trigger review_reject_audit on audit_log"); }
  });

  it("serializes PIN failures and resets an expired lock's counter", async () => {
    const { recordPinFailure } = await import("@/lib/services/pin-lockout");
    await Promise.all(Array.from({ length: 5 }, () => recordPinFailure(userId)));
    const [locked] = (await admin.query("select failed_pin_attempts,pin_locked_until from users where id=$1", [userId])).rows;
    expect(locked.failed_pin_attempts).toBe(5);
    expect(locked.pin_locked_until).toBeInstanceOf(Date);
    await admin.query("update users set pin_locked_until=now()-interval '1 minute' where id=$1", [userId]);
    await recordPinFailure(userId);
    expect((await admin.query("select failed_pin_attempts,pin_locked_until from users where id=$1", [userId])).rows[0])
      .toEqual({ failed_pin_attempts: 1, pin_locked_until: null });
  });

  it("refuses an unsafe invoice aggregate before allocating or persisting it", async () => {
    const { issueInvoiceInTx } = await import("@/lib/services/invoice-issue");
    const { withTenant } = await import("@/db/tenant");
    const result = await withTenant(tenantId, tx => issueInvoiceInTx(tx, {
      tenantId, memberId: memberA, locationId: locationA, issuedOn: "2026-10-01", dueOn: "2026-10-01",
      lines: [{ description: "Synthetic maximum", amountPaise: Number.MAX_SAFE_INTEGER }, { description: "Two paise", amountPaise: 2 }],
    }, userId));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("exact paise range") });
    expect((await admin.query("select id from invoices where tenant_id=$1", [tenantId])).rows).toEqual([]);
    expect((await admin.query("select * from invoice_number_counters where tenant_id=$1", [tenantId])).rows).toEqual([]);
  });

  it("uses the same active-member cohort for retention numerator and denominator", async () => {
    const { getRetentionView } = await import("@/lib/services/owner-reports");
    await admin.query("update members set status='left' where id=$1", [memberB]);
    await admin.query("delete from attendance where member_id=$1", [memberA]);
    // The inactive member has a recent mark; the sole active member has none.
    await admin.query("update sessions set session_date=current_date where id=$1", [sessionB]);
    expect(await getRetentionView(owner)).toMatchObject({ totalActiveMembers: 1, memberCountAtRisk: 1, membersWithZeroLast30: 1 });
  });
});
