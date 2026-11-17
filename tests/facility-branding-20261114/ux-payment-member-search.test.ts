import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { listMembers } from "@/lib/services/people";

let f: Awaited<ReturnType<typeof fixture>>;
const personB = uuidv7(), memberB = uuidv7(), foreignLocation = uuidv7(), foreignPerson = uuidv7(), foreignMember = uuidv7();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update persons set full_name='Same Name' where id=$1", [f.personId]);
  await f.admin.query("update members set member_code='SITE-A-947' where id=$1", [f.memberId]);
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Same Name')", [personB, f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','SITE-B-853')", [memberB, f.tenantId, personB, f.locationB]);
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Other',true)", [foreignLocation, f.otherTenant]);
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Other Name')", [foreignPerson, f.otherTenant]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','FOREIGN-999')", [foreignMember, f.otherTenant, foreignPerson, foreignLocation]);
});
afterAll(async () => { await f?.cleanup(); });
it("finds an exact member code while preserving site scope and distinguishing duplicate names", async () => {
  const owner = await listMembers(f.context(), { search: "SITE-B-853" });
  expect(owner.map((row) => row.memberId)).toEqual([memberB]);
  const manager = await listMembers(f.context(f.managerId, "manager"), { search: "SITE-B-853" });
  expect(manager).toEqual([]);
  const scoped = await listMembers(f.context(f.managerId, "manager"), { search: "SITE-A-947" });
  expect(scoped.map((row) => row.memberId)).toEqual([f.memberId]);
  const sameName = await listMembers(f.context(), { search: "Same Name" });
  expect(sameName.map((row) => row.memberCode).sort()).toEqual(["SITE-A-947", "SITE-B-853"]);
  expect(await listMembers(f.context(), { search: "FOREIGN-999" })).toEqual([]);
});
