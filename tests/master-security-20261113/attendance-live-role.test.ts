import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { asUserId } from "@/lib/ids";
import { markAttendance } from "@/lib/services/attendance-mark";

let f: Awaited<ReturnType<typeof fixture>>;
const coach = asUserId(randomUUID()), coachRole = randomUUID(), session = randomUUID();
beforeAll(async () => {
  f = await fixture();
  const phone = `+9198${String(BigInt(`0x${randomUUID().replaceAll("-", "").slice(-12)}`) % 100_000_000n).padStart(8, "0")}`;
  await f.admin.query("insert into users(id,phone) values($1,$2)", [coach, phone]);
  await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'coach','Coach','/coach',2)", [coachRole, f.tenantId]);
  await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'attendance.mark')", [f.tenantId, coachRole]);
  await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [randomUUID(), f.tenantId, coach, coachRole]);
  await f.admin.query("update staff set user_id=$1 where id=$2", [coach, f.coachId]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,'2026-11-13','2026-11-13T10:00Z','2026-11-13T11:00Z')", [session, f.tenantId, f.batchA, f.locationA, f.coachId]);
  await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, f.memberId, f.batchA]);
});
afterAll(async () => {
  if (!f) return;
  await f.cleanup();
});

it.each([undefined, "receptionist"])("refuses a real Owner with claimed role %s without writes or audit", async (roleKey) => {
  const ctx = { tenantId: f.tenantId, userId: f.userId, ...(roleKey ? { roleKey } : {}) };
  const before = await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='attendance.mark'", [f.tenantId]);
  await expect(markAttendance(ctx, { sessionId: session, memberId: f.memberId, status: "present", clientId: randomUUID() })).rejects.toThrow();
  expect((await f.admin.query("select id from attendance where tenant_id=$1 and session_id=$2", [f.tenantId, session])).rowCount).toBe(0);
  expect((await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='attendance.mark'", [f.tenantId])).rows[0].n).toBe(before.rows[0].n);
});

it("allows live Reception and the assigned Coach, then refuses a revoked membership and removed grant", async () => {
  await expect(markAttendance(f.context(f.receptionistId, "receptionist"), { sessionId: session, memberId: f.memberId, status: "present", clientId: randomUUID() })).resolves.toBeUndefined();
  await expect(markAttendance({ tenantId: f.tenantId, userId: coach, roleKey: "coach" }, { sessionId: session, memberId: f.memberId, status: "late", clientId: randomUUID() })).resolves.toBeUndefined();
  const before = await f.admin.query("select status,client_id from attendance where tenant_id=$1 and session_id=$2", [f.tenantId, session]);
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.tenantId, coach]);
  await expect(markAttendance({ tenantId: f.tenantId, userId: coach, roleKey: "coach" }, { sessionId: session, memberId: f.memberId, status: "absent", clientId: randomUUID() })).rejects.toThrow();
  await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2) and permission_key='attendance.mark'", [f.tenantId, f.receptionistId]);
  await expect(markAttendance(f.context(f.receptionistId, "receptionist"), { sessionId: session, memberId: f.memberId, status: "absent", clientId: randomUUID() })).rejects.toThrow();
  expect((await f.admin.query("select status,client_id from attendance where tenant_id=$1 and session_id=$2", [f.tenantId, session])).rows).toEqual(before.rows);
});
