import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { if (f) { await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]); await f.cleanup(); } });

it.each(["receptionist", "coach", "worker", "accountant", "admin"])("honors a restricted %s membership even when the legacy setting is off", async (role) => {
  await f.admin.query("update tenant_memberships set all_locations=false where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  await f.admin.query("update roles set key=$1 where tenant_id=$2 and id=(select role_id from tenant_memberships where tenant_id=$2 and user_id=$3)", [role, f.tenantId, f.receptionistId]);
  await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) select $1,$2,id,$3 from tenant_memberships where tenant_id=$2 and user_id=$4 on conflict do nothing", [randomUUID(), f.tenantId, f.locationA, f.receptionistId]);
  const access = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, { tenantId: f.tenantId, userId: f.receptionistId }));
  expect(locationVisible(access, f.locationA)).toBe(true);
  expect(locationVisible(access, f.locationB)).toBe(false);
});

it("denies a system marker mixed with human role or permission claims", async () => {
  for (const claims of [{ roleKey: "owner" }, { permissions: new Set(["settings.manage"]) }]) {
    const access = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, { tenantId: f.tenantId, systemActor: true, ...claims }));
    expect(locationVisible(access, f.locationA)).toBe(false);
  }
});

it.each([false, true])("preserves an all-location appointment but denies its revocation with switch %s", async (enabled) => {
  await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
  if (enabled) await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true'::jsonb)", [randomUUID(), f.tenantId]);
  await f.admin.query("update roles set key='receptionist' where id=(select role_id from tenant_memberships where tenant_id=$1 and user_id=$2)", [f.tenantId, f.receptionistId]);
  await f.admin.query("update tenant_memberships set status='active',all_locations=true where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  const ctx = f.context(f.receptionistId, "receptionist");
  const active = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, ctx));
  expect(locationVisible(active, f.locationA)).toBe(true);
  expect(locationVisible(active, f.locationB)).toBe(true);
  expect(locationVisible(active, null)).toBe(true);
  await f.admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [f.tenantId, f.receptionistId]);
  const revoked = await withTenant(f.tenantId, (tx) => resolveLocationAccess(tx, ctx));
  expect(locationVisible(revoked, f.locationA)).toBe(false);
  expect(locationVisible(revoked, f.locationB)).toBe(false);
  expect(locationVisible(revoked, null)).toBe(false);
});
