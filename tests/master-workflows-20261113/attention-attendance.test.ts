import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { getOwnerDashboard } from "@/lib/services/dashboard";
import { todayInZone } from "@/lib/time/tz";

let f: Awaited<ReturnType<typeof fixture>>;
const session = randomUUID();
const today = todayInZone("Asia/Kolkata");
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on) values($1,$2,$3,$4,$5)",[randomUUID(),f.tenantId,f.memberId,f.batchA,today]);
  await f.admin.query("insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values($1,$2,$3,$4,$5,$6,$7)",[session,f.tenantId,f.batchA,f.locationA,today,new Date(Date.now()-3600000),new Date(Date.now()+3600000)]);
});
afterAll(async () => {await f?.cleanup();});
it("links an unstarted register to that batch, date and facility without offering a coach write", async () => {
  const data = await getOwnerDashboard(f.context(),{locationId:f.locationA});
  const item = data.needsAttention.find(row => row.title === "Register not started");
  expect(item?.href).toContain(`/owner/reports/attendance`);
  expect(item?.href).toContain(`batch=${f.batchA}`);
  expect(item?.href).toContain(`from=${today}`);
  expect(item?.href).toContain(`facility=${f.locationA}`);
});
