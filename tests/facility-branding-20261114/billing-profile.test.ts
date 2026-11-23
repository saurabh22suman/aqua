import { afterAll, beforeAll, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { updateTenantProfile } from "@/lib/services/tenant-profile";

const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const locationId = uuidv7();
const orderId = uuidv7();
const roleId = uuidv7();

beforeAll(async () => {
  await admin.query("insert into tenants (id,slug,name,status,gstin) values ($1,$2,'Profile test','active','27ABCDE1234F1Z5')", [tenantId, `profile-billing-${tenantId}`]);
  await admin.query("insert into users (id,phone) values ($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values ($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values ($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Site',true)", [locationId, tenantId]);
  await admin.query("insert into orders(id,tenant_id,location_id,status) values ($1,$2,$3,'placed')", [orderId, tenantId, locationId]);
  await admin.query("insert into location_billing_settings(tenant_id,location_id,state_code,facility_billing_enabled,mode) values ($1,$2,'27',true,'inherit')", [tenantId, locationId]);
});

afterAll(async () => {
  await admin.query("delete from orders where id=$1", [orderId]);
  await admin.query("delete from locations where id=$1", [locationId]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenantId]);
  await admin.query("delete from roles where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  // Audit rows retain the actor; leave the synthetic user in the disposable DB.
  await admin.end();
});

it("blocks a profile GSTIN change with an affected unbilled order but allows an identical value", async () => {
  const ctx = { tenantId, userId };
  expect(await updateTenantProfile(ctx, { gstin: "27ABCDE1234F1Z5" })).toEqual({ kind: "ok" });
  const changed = await updateTenantProfile(ctx, { gstin: "27ABCDE1234F1Z6" });
  expect(changed.kind).toBe("error");
  const stored = await admin.query<{ gstin: string }>("select gstin from tenants where id=$1", [tenantId]);
  expect(stored.rows[0]?.gstin).toBe("27ABCDE1234F1Z5");
});
