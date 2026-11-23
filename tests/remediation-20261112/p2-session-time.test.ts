import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { rescheduleSession } from "@/lib/services/session-lifecycle";
let f:Awaited<ReturnType<typeof fixture>>;
beforeAll(async()=>{f=await fixture();});afterAll(async()=>{await f?.cleanup();});
async function session() {
  const id=randomUUID(),date=`2026-11-${String(13+(await f.admin.query("select count(*)::int as n from sessions where tenant_id=$1",[f.tenantId])).rows[0].n).padStart(2,"0")}`;
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",[id,f.tenantId,f.batchA,f.locationA,date,`${date}T08:00Z`,`${date}T09:00Z`]);
  return {id,date};
}
describe("F06 same-day rescheduling",()=>{
  it("saves changed times on the same date and audits the change",async()=>{
    const {id,date}=await session();
    expect((await rescheduleSession(f.context(),{sessionId:id,newSessionDate:date,newStartsAt:new Date(`${date}T10:00Z`),newEndsAt:new Date(`${date}T11:00Z`)})).kind).toBe("ok");
    const {rows:[row]}=await f.admin.query("select starts_at,ends_at from sessions where id=$1",[id]);
    expect(row.starts_at.toISOString()).toBe(`${date}T10:00:00.000Z`);expect(row.ends_at.toISOString()).toBe(`${date}T11:00:00.000Z`);
    expect((await f.admin.query("select id from audit_log where entity_id=$1 and action='session.reschedule.notification'",[id])).rowCount).toBe(1);
  });
  it("refuses only a genuinely identical date and time",async()=>{
    const {id,date}=await session();
    expect(await rescheduleSession(f.context(),{sessionId:id,newSessionDate:date,newStartsAt:new Date(`${date}T08:00Z`),newEndsAt:new Date(`${date}T09:00Z`)})).toMatchObject({kind:"error",code:"no_change"});
  });
  it("does not change another tenant's session",async()=>{
    const {id,date}=await session();
    expect((await rescheduleSession({...f.context(),tenantId:f.otherTenant},{sessionId:id,newSessionDate:date,newStartsAt:new Date(`${date}T10:00Z`),newEndsAt:new Date(`${date}T11:00Z`)})).kind).toBe("error");
  });
});
