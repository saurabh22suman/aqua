import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture } from "./fixture";
import { holdFirstRead } from "./query-gate";
import { pauseSubscription, resumeSubscription, cancelSubscription } from "@/lib/services/subscriptions";
import { addDays, todayInZone } from "@/lib/time/tz";

let f:Awaited<ReturnType<typeof fixture>>;
const today=todayInZone("Asia/Kolkata");
beforeAll(async()=>{f=await fixture();});
afterAll(async()=>{await f?.cleanup();});
async function subscription(status:"paused"|"active") {
  // Each case owns a separate plan, preserving the active-plan unique index.
  const plan=randomUUID(),id=randomUUID();
  await f.admin.query("insert into membership_plans(id,tenant_id,name,kind,duration_days,amount_paise,location_id) values($1,$2,'Concurrent monthly','duration',30,10000,$3)",[plan,f.tenantId,f.locationA]);
  await f.admin.query("insert into subscriptions(id,tenant_id,member_id,plan_id,location_id,starts_on,ends_on,status,paused_from) values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,f.tenantId,f.memberId,plan,f.locationA,addDays(today,-10),addDays(today,20),status,status==="paused"?addDays(today,-2):null]);
  return id;
}
describe("F03 subscription transition serialization",()=>{
  for(const first of ["resume","pause"] as const) {
    it(`a concurrent cancellation remains final after ${first}`,async()=>{
      const id=await subscription(first==="resume"?"paused":"active");
      const gate=holdFirstRead(/select .* from "subscriptions"/i);
      try {
        const pending=first==="resume"?resumeSubscription(f.context(),{id}):pauseSubscription(f.context(),{id});
        await gate.reached;
        const cancel=cancelSubscription(f.context(),{id});
        await gate.waitForCompetition(f.admin,cancel);gate.release();
        const [firstResult,cancelResult]=await Promise.all([pending,cancel]);
        expect(firstResult.ok).toBe(true);expect(cancelResult.ok).toBe(true);
        expect((await f.admin.query("select status from subscriptions where id=$1",[id])).rows[0].status).toBe("cancelled");
      } finally {gate.close();}
    },10000);
  }
  it("only one overlapping resume succeeds and extends validity once",async()=>{
    const id=await subscription("paused");
    const results=await Promise.all([resumeSubscription(f.context(),{id}),resumeSubscription(f.context(),{id})]);
    expect(results.filter(r=>r.ok)).toHaveLength(1);
    const {rows:[row]}=await f.admin.query("select ends_on::text from subscriptions where id=$1",[id]);
    expect(row.ends_on).toBe(addDays(today,22));
  });
  it("another tenant cannot transition the subscription or write an audit",async()=>{
    const id=await subscription("paused");
    const result=await resumeSubscription({...f.context(),tenantId:f.otherTenant},{id});
    expect(result.ok).toBe(false);
    expect((await f.admin.query("select status from subscriptions where id=$1",[id])).rows[0].status).toBe("paused");
    expect((await f.admin.query("select id from audit_log where entity_id=$1",[id])).rowCount).toBe(0);
  });
});
