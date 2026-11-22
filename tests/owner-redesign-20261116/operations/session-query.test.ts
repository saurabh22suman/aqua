import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { canSelectFacility } from "@/lib/services/selected-facility-access";

let f: Awaited<ReturnType<typeof fixture>>;
const foreign = randomUUID(), deleted = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update locations set name=case id when $1 then 'North' else 'South' end where tenant_id=$2", [f.locationA, f.tenantId]);
  await f.admin.query("insert into locations (id,tenant_id,name,is_primary,deleted_at) values ($1,$2,'Deleted',false,now()),($3,$4,'Foreign',false,null)", [deleted, f.tenantId, foreign, f.otherTenant]);
  await f.admin.query("update batches set name='Beginners' where id=any($1::uuid[])", [[f.batchA, f.batchB]]);
  await f.admin.query("insert into sessions (id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at) values ($1,$3,$4,$6,'2030-01-07','2030-01-07T01:30Z','2030-01-07T02:30Z'),($2,$3,$5,$7,'2030-01-07','2030-01-07T01:30Z','2030-01-07T02:30Z')", [randomUUID(), randomUUID(), f.tenantId, f.batchA, f.batchB, f.locationA, f.locationB]);
});
afterAll(async () => { await f?.cleanup(); });
it("filters at the session query and distinguishes identically named batches by site", async () => {
  const all = await listUpcomingSessions(f.context(), "2030-01-01", "2030-01-31");
  expect(all.map(row => row.locationName).sort()).toEqual(["North", "South"]);
  const one = await listUpcomingSessions(f.context(), "2030-01-01", "2030-01-31", f.locationA);
  expect(one.map(row => [row.batchName, row.locationId, row.locationName])).toEqual([["Beginners", f.locationA, "North"]]);
});
it("does not broaden a denied caller with an explicit facility", async () => {
  expect(await listUpcomingSessions({tenantId:f.tenantId}, "2030-01-01", "2030-01-31", f.locationA)).toEqual([]);
});
it("retains a restricted manager's scope for all and explicit facility queries",async()=>{
  const ctx=f.context(f.managerId,"manager");
  expect((await listUpcomingSessions(ctx,"2030-01-01","2030-01-31")).map(row=>row.locationId)).toEqual([f.locationA]);
  expect(await listUpcomingSessions(ctx,"2030-01-01","2030-01-31",f.locationB)).toEqual([]);
});
it("does not permit a deleted or foreign location even for an unrestricted live owner", async () => {
  expect(await canSelectFacility(f.context(), f.locationA)).toBe(true);
  expect(await canSelectFacility(f.context(), deleted)).toBe(false);
  expect(await canSelectFacility(f.context(), foreign)).toBe(false);
});
