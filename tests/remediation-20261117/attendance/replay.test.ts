import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "../../remediation-20261112/fixture";
import { markAttendance } from "@/lib/services/attendance-mark";

let f: Awaited<ReturnType<typeof fixture>>;
let day = 1;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into enrolments(id,tenant_id,batch_id,member_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), f.tenantId, f.batchA, f.memberId]);
});
afterAll(async () => { if (f) await f.cleanup(); });

async function session() {
  const id = randomUUID(), date = `2026-11-${String(day++).padStart(2, "0")}`;
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)", [id, f.tenantId, f.batchA, f.locationA, date, `${date}T08:00Z`, `${date}T09:00Z`]);
  return id;
}
const actor = () => f.context(f.receptionistId, "receptionist");
async function state(id: string) {
  const marks = await f.admin.query("select status,client_id from attendance where tenant_id=$1 and session_id=$2", [f.tenantId, id]);
  const audits = await f.admin.query("select id from audit_log where tenant_id=$1 and action='attendance.mark' and after->>'sessionId'=$2", [f.tenantId, id]);
  return { mark: marks.rows[0], audits: audits.rowCount };
}

describe("attendance operation replay", () => {
  it("keeps correction B authoritative after delayed duplicate A without another audit", async () => {
    const id = await session();
    const a = { sessionId: id, memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    const b = { ...a, status: "absent" as const, clientId: randomUUID() };
    await markAttendance(actor(), a);
    await markAttendance(actor(), b);
    await markAttendance(actor(), a);
    expect(await state(id)).toEqual({ mark: { status: "absent", client_id: b.clientId }, audits: 2 });
  });
  it("does not audit a current duplicate and rejects a changed payload", async () => {
    const id = await session();
    const a = { sessionId: id, memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    await markAttendance(actor(), a);
    await markAttendance(actor(), a);
    await expect(markAttendance(actor(), { ...a, status: "late" })).rejects.toThrow();
    expect(await state(id)).toEqual({ mark: { status: "present", client_id: a.clientId }, audits: 1 });
  });
  it("coalesces simultaneous identical requests into one mark and audit", async () => {
    const id = await session();
    const a = { sessionId: id, memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    await Promise.all([markAttendance(actor(), a), markAttendance(actor(), a)]);
    expect(await state(id)).toEqual({ mark: { status: "present", client_id: a.clientId }, audits: 1 });
  });
  it("rejects a historical operation ID reused for another session", async () => {
    const first = await session(), second = await session();
    const a = { sessionId: first, memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    await markAttendance(actor(), a);
    await markAttendance(actor(), { ...a, status: "late", clientId: randomUUID() });
    await expect(markAttendance(actor(), { ...a, status: "absent" })).rejects.toThrow();
    await expect(markAttendance(actor(), { ...a, sessionId: second })).rejects.toThrow();
    expect((await state(second)).audits).toBe(0);
  });
  it("serializes simultaneous different-session requests using one operation ID", async () => {
    const first = await session(), second = await session();
    const input = { memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    const results = await Promise.allSettled([
      markAttendance(actor(), { ...input, sessionId: first }),
      markAttendance(actor(), { ...input, sessionId: second }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await state(first)).audits! + (await state(second)).audits!).toBe(1);
  });
  it("does not treat another tenant's operation ID as a replay", async () => {
    const other = await fixture();
    try {
      const first = await session(), second = randomUUID(), clientId = randomUUID();
      await other.admin.query("insert into enrolments(id,tenant_id,batch_id,member_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')", [randomUUID(), other.tenantId, other.batchA, other.memberId]);
      await other.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,'2026-11-20','2026-11-20T08:00Z','2026-11-20T09:00Z')", [second, other.tenantId, other.batchA, other.locationA]);
      await markAttendance(actor(), { sessionId: first, memberId: f.memberId, status: "present", clientId });
      await markAttendance(other.context(other.receptionistId, "receptionist"), { sessionId: second, memberId: other.memberId, status: "absent", clientId });
      const result = await other.admin.query("select status from attendance where tenant_id=$1 and session_id=$2", [other.tenantId, second]);
      expect(result.rows).toEqual([{ status: "absent" }]);
    } finally { await other.cleanup(); }
  });
  it("checks cancellation, live grants and tenant even for a duplicate", async () => {
    const id = await session();
    const a = { sessionId: id, memberId: f.memberId, status: "present" as const, clientId: randomUUID() };
    await markAttendance(actor(), a);
    await expect(markAttendance({ ...actor(), tenantId: f.otherTenant }, a)).rejects.toThrow();
    await f.admin.query("update sessions set status='cancelled' where id=$1", [id]);
    await expect(markAttendance(actor(), a)).rejects.toThrow();
    await f.admin.query("update sessions set status='scheduled' where id=$1", [id]);
    await f.admin.query("delete from role_permissions where tenant_id=$1 and role_id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2) and permission_key='attendance.mark'", [f.tenantId, f.receptionistId]);
    try { await expect(markAttendance(actor(), a)).rejects.toThrow(); }
    finally { await f.admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,role_id,'attendance.mark' from tenant_memberships where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]); }
    expect((await state(id)).audits).toBe(1);
  });
});
