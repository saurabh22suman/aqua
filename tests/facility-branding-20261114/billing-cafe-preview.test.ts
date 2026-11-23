import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";

const session = vi.hoisted(() => ({ ctx: {} }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => session.ctx }));
vi.mock("@/lib/auth/permission", () => ({ requirePermission: () => undefined }));
import { listMenuAction } from "@/lib/actions/menu";

const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const roleId = uuidv7();
const registeredSite = uuidv7();
const unregisteredSite = uuidv7();
const registration = uuidv7();
const address = { line1: "Street", line2: null, city: "Bengaluru", postalCode: "560001" };

beforeAll(async () => {
  session.ctx = { tenantId, userId };
  await admin.query("insert into tenants(id,slug,name,status,gstin) values($1,$2,'Preview','active',null)", [tenantId, `preview-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$3,'Registered',true),($2,$3,'Unregistered',false)", [registeredSite, unregisteredSite, tenantId]);
  await admin.query("insert into billing_registrations(id,tenant_id,legal_name,legal_address,state_code,gstin) values($1,$2,'Site',$3::jsonb,'29','29ABCDE1234F1Z5')", [registration, tenantId, JSON.stringify(address)]);
  await admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,registration_id) values($1,$2,'29',true,'registered_override',$3)", [tenantId, registeredSite, registration]);
  await admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode,unregistered_legal_name,unregistered_legal_address) values($1,$2,'29',true,'unregistered_override','No GST',$3::jsonb)", [tenantId, unregisteredSite, JSON.stringify(address)]);
});
afterAll(async () => {
  await admin.query("delete from locations where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenantId]);
  await admin.query("delete from roles where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  await admin.query("delete from users where id=$1", [userId]);
  await admin.end();
});

it("quotes a registered selected site even when the club is unregistered", async () => {
  const menu = await listMenuAction({ locationId: registeredSite });
  expect(menu.taxRegistered).toBe(true);
});
it("quotes an unregistered selected site even when the club is registered", async () => {
  await admin.query("update tenants set gstin='27ABCDE1234F1Z5' where id=$1", [tenantId]);
  const menu = await listMenuAction({ locationId: unregisteredSite });
  expect(menu.taxRegistered).toBe(false);
});
it("does not invent a registration for an ambiguous or unavailable site", async () => {
  expect((await listMenuAction({})).taxRegistered).toBeNull();
  expect((await listMenuAction({ locationId: uuidv7() })).taxRegistered).toBeNull();
});
it("does not return a site quote after membership revocation", async () => {
  await admin.query("update tenant_memberships set status='revoked' where tenant_id=$1 and user_id=$2", [tenantId, userId]);
  const menu = await listMenuAction({ locationId: registeredSite });
  expect(menu.taxRegistered).toBeNull();
  expect(menu.taxRegistrationByLocation).toEqual({});
});
