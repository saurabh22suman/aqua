import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
vi.mock("@/lib/messaging/notification-enqueue", () => ({enqueueMemberNotification:vi.fn(),enqueueStaffNotification:vi.fn()}));
import { detectAbsenceAlerts } from "@/lib/services/absence-alerts";
let f:Awaited<ReturnType<typeof fixture>>;
const configId = randomUUID();
const sessionIds = Array.from({length:5},() => randomUUID());
beforeAll(async () => {
  vi.useFakeTimers({toFake:["Date"]});
  vi.setSystemTime(new Date("2026-11-13T08:00:00Z"));
  f = await fixture();
  await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'attendance.absence_alert_threshold_pct','tenant',$2::uuid::text,$2::uuid,'20'::jsonb)",[configId,f.tenantId]);
  for (let i=0;i<5;i++) {
    const day = `2026-11-${String(i+1).padStart(2,"0")}`;
    await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at,status) values($1,$2,$3,$4,$5,$6,$7,'held')",[sessionIds[i],f.tenantId,f.batchA,f.locationA,day,`${day}T04:30:00Z`,`${day}T05:30:00Z`]);
  }
});
afterAll(async () => { vi.useRealTimers(); if (f) {await f.admin.query("delete from absence_alerts where tenant_id=$1",[f.tenantId]); await f.admin.query("delete from config_values where id=$1",[configId]); await f.cleanup();} });
async function run(threshold:number, marks:string[]) {
  await f.admin.query("delete from attendance where tenant_id=$1",[f.tenantId]);
  await f.admin.query("delete from absence_alerts where tenant_id=$1",[f.tenantId]);
  await f.admin.query("update config_values set value=$2::jsonb where id=$1",[configId,JSON.stringify(threshold)]);
  for (let i=0;i<marks.length;i++) await f.admin.query("insert into attendance(id,tenant_id,session_id,member_id,status,client_id) values($1,$2,$3,$4,$5,$6)",[randomUUID(),f.tenantId,sessionIds[i],f.memberId,marks[i],randomUUID()]);
  await detectAbsenceAlerts(f.context());
  const result = await f.admin.query("select detail from absence_alerts where tenant_id=$1 and alert_kind='low_monthly_attendance'",[f.tenantId]);
  return result.rows;
}
it("uses present and late marks and a strict threshold of 20 or 80", async () => {
  const marks=["absent","present","absent","late","absent"];
  expect(await run(20,marks)).toHaveLength(0);
  expect(await run(80,marks)).toHaveLength(1);
  expect(await run(20,["absent","absent","present","absent","absent"])).toHaveLength(0);
  expect(await run(80,["present","late","present","late","absent"])).toHaveLength(0);
  expect(await run(80,["absent","present","absent"])).toHaveLength(0);
});
