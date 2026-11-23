import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { listTodaySessions } from "@/lib/services/register";
import { getCoachNextUpcoming } from "@/lib/services/coach-schedule";
let f:Awaited<ReturnType<typeof fixture>>;
const date="2026-11-13";
beforeAll(async () => {
  f = await fixture();
  for (const [batch,location,time] of [[f.batchA,f.locationA,"05:30"],[f.batchB,f.locationB,"04:30"]]) {
    await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,coach_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7,$8)",[randomUUID(),f.tenantId,batch,location,f.coachId,date,`${date}T${time}:00Z`,`${date}T06:30:00Z`]);
  }
});
it("does not select an earlier upcoming session from an unauthorized venue", async () => {
  try {
    await f.admin.query("update staff set user_id=$2 where id=$1",[f.coachId,f.managerId]);
    const ctx = {...f.context(f.managerId,"manager"),roleKey:"coach"};
    const result = await getCoachNextUpcoming(ctx,"2026-11-12",7);
    expect(result?.batchName).toBe("Batch A");
    expect(result?.locationName).toBe("A");
  } finally {
    await f.admin.query("update staff set user_id=$2 where id=$1",[f.coachId,f.userId]);
  }
});
afterAll(async () => { if (f) await f.cleanup(); });
it("returns actual venue names without widening a restricted caller's locations", async () => {
  const all = await listTodaySessions(f.context(),date);
  expect(all.map(row => row.locationName).sort()).toEqual(["A","B"]);
  const scoped = await listTodaySessions(f.context(f.managerId,"manager"),date);
  expect(scoped.map(row => row.locationName)).toEqual(["A"]);
});
