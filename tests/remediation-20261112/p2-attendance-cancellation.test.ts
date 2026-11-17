import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { fixture } from "./fixture";
import { holdFirstRead } from "./query-gate";
import { markAttendance } from "@/lib/services/attendance-mark";
import { cancelSession } from "@/lib/services/session-lifecycle";
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();await f.admin.query("insert into enrolments(id,tenant_id,batch_id,member_id,enrolled_on) values($1,$2,$3,$4,'2026-01-01')",[randomUUID(),f.tenantId,f.batchA,f.memberId]);});
afterAll(async()=>{await f?.cleanup();});
let day=12;
async function session(){const id=randomUUID(),date=`2026-11-${day++}`;await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",[id,f.tenantId,f.batchA,f.locationA,date,`${date}T08:00Z`,`${date}T09:00Z`]);return id;}
const mark=(id:string,status:"present"|"absent"|"late"="present")=>markAttendance(f.context(f.receptionistId,"receptionist"),{sessionId:id,memberId:f.memberId,status,clientId:randomUUID()});
describe("F11 attendance and cancellation share a serialized boundary",()=>{
  it.each(["present","absent","late"] as const)("refuses cancellation after a saved %s mark",async status=>{
    const id=await session();await mark(id,status);
    expect(await cancelSession(f.context(),id)).toMatchObject({kind:"error",code:"cannot_cancel_held"});
    expect((await f.admin.query("select status from sessions where id=$1",[id])).rows[0].status).toBe("scheduled");
    expect((await f.admin.query("select id from audit_log where entity_id=$1 and action='session.cancel.notification'",[id])).rowCount).toBe(0);
  });
  it("rejects attendance after cancellation",async()=>{const id=await session();expect((await cancelSession(f.context(),id)).kind).toBe("ok");await expect(mark(id)).rejects.toThrow();});
  it("refuses a cancellation that overlaps an attendance transaction",async()=>{
    const id=await session(),gate=holdFirstRead(/(?:select .* from "sessions"|update "sessions")/i);
    try {const marking=mark(id);await gate.reached;const cancellation=cancelSession(f.context(),id);await gate.waitForCompetition(f.admin,cancellation);gate.release();await marking;expect(await cancellation).toMatchObject({kind:"error",code:"cannot_cancel_held"});}
    finally {gate.close();}
  },10000);
});
