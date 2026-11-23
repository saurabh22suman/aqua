import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";

const state = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => state.ctx }));
import { getSiteBillingSettingAction, saveSiteBillingSettingAction } from "@/lib/actions/facility-billing";

const tenant = uuidv7(), otherTenant = uuidv7(), user = uuidv7(), role = uuidv7(), membership = uuidv7(), site = uuidv7(), foreign = uuidv7();
beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status) values($1,$2,'Fixture','active'),($3,$4,'Other','active')", [tenant, `ui-${tenant}`, otherTenant, `ui-${otherTenant}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [user, `+91${String(BigInt(`0x${user.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [role, tenant]);
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'settings.manage')", [tenant, role]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [membership, tenant, user, role]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Named site',true),($3,$4,'Other site',true)", [site, tenant, foreign, otherTenant]);
  state.ctx = { tenantId: tenant, userId: user, roleKey: "owner", permissions: new Set(["settings.manage"]) };
});
afterAll(async () => {
  await admin.query("delete from locations where tenant_id in ($1,$2)", [tenant, otherTenant]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenant]);
  await admin.query("delete from roles where tenant_id=$1", [tenant]);
  await admin.query("delete from tenants where id in ($1,$2)", [tenant, otherTenant]);
  await admin.end();
});

it("authorizes a live owner for the named site and denies foreign and revoked scope", async () => {
  const read = await getSiteBillingSettingAction(site);
  expect(read.ok && read.value.locationName).toBe("Named site");
  const input = { locationId: site, stateCode: "27", choice: { mode: "inherit" }, enable: false };
  const saved = await saveSiteBillingSettingAction(input);
  expect(saved.ok && saved.value.enabled).toBe(false);
  const foreignRead = await getSiteBillingSettingAction(foreign);
  expect(!foreignRead.ok && foreignRead.code).toBe("not_found");
  await admin.query("update tenant_memberships set status='revoked' where id=$1", [membership]);
  const denied = await saveSiteBillingSettingAction({ ...input, stateCode: "29" });
  expect(!denied.ok && denied.code).toBe("owner_required");
  const audits = await admin.query<{ n: number }>("select count(*)::int n from audit_log where tenant_id=$1 and action='facility_billing.site.update'", [tenant]);
  expect(audits.rows[0].n).toBe(1);
});
