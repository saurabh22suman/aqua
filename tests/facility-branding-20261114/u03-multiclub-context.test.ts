import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { resolveDefaultMembership, resolveSessionForLogin } from "@/db/platform";
import { getBranding } from "@/lib/services/branding";
import { staffSiteContext } from "@/lib/services/staff-scope";

let f: Awaited<ReturnType<typeof fixture>>;
let baId: string;
beforeAll(async () => {
  f = await fixture(); baId = randomUUID();
  const role = randomUUID(), membership = randomUUID(), site = randomUUID();
  await f.admin.query("insert into ba_user(id,name,email) values($1,'Synthetic user',$2)", [baId, `${baId}@fixture.invalid`]);
  await f.admin.query("update users set better_auth_id=$2 where id=$1", [f.userId, baId]);
  await f.admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'worker','Worker','/worker',4)", [role, f.otherTenant]);
  await f.admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',false)", [membership, f.otherTenant, f.userId, role]);
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Worker site',true)", [site, f.otherTenant]);
  await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), f.otherTenant, membership, site]);
});
afterAll(async () => { if (f) await f.cleanup(); });

it("re-resolves role, landing, branding and site for each selected club", async () => {
  expect(await resolveDefaultMembership(baId, f.otherTenant)).toMatchObject({ tenantId: f.otherTenant, roleKey: "worker" });
  expect(await resolveSessionForLogin(baId, f.otherTenant)).toEqual({ kind: "ok", path: "/worker" });
  expect((await getBranding({ tenantId: f.otherTenant })).fallbackDisplayName).toBe("Remediation B");
  expect(await staffSiteContext({ tenantId: f.otherTenant, userId: f.userId })).toBe("Worker site");
  expect(await resolveDefaultMembership(baId, f.tenantId)).toMatchObject({ tenantId: f.tenantId, roleKey: "owner" });
  expect(await resolveSessionForLogin(baId, f.tenantId)).toEqual({ kind: "ok", path: "/owner" });
  expect((await getBranding({ tenantId: f.tenantId })).fallbackDisplayName).toBe("Remediation A");
});
