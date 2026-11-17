import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { privilegedFixturePool as admin } from "@/tests/db/privileged-fixture";
import { asTenantId, asUserId } from "@/lib/ids";
import { createBillingRegistration, getClubBillingDefault, getSiteBillingSetting, resetSiteBillingSetting, saveClubBillingDefault, saveSiteBillingSetting } from "@/lib/services/facility-billing-settings";

const tenantId = asTenantId(uuidv7());
const userId = asUserId(uuidv7());
const roleId = uuidv7();
const locationId = uuidv7();
const otherSite = uuidv7();
const ctx = { tenantId, userId };
const address = { line1: "Site road", line2: null, city: "Mumbai", postalCode: "400001" };

beforeAll(async () => {
  await admin.query("insert into tenants(id,slug,name,status,gstin) values($1,$2,'Settings test','active','27ABCDE1234F1Z5')", [tenantId, `settings-${tenantId}`]);
  await admin.query("insert into users(id,phone) values($1,$2)", [userId, `+91${String(BigInt(`0x${userId.replaceAll('-', '').slice(-10)}`) % 10000000000n).padStart(10, '0')}`]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$2,'owner','Owner','/owner',0)", [roleId, tenantId]);
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) values($1,$2,'settings.manage')", [tenantId, roleId]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$2,$3,$4,'active',true)", [uuidv7(), tenantId, userId, roleId]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$3,'Main',true),($2,$3,'Second',false)", [locationId, otherSite, tenantId]);
});
afterAll(async () => {
  await admin.query("delete from orders where tenant_id=$1", [tenantId]);
  await admin.query("delete from locations where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenant_memberships where tenant_id=$1", [tenantId]);
  await admin.query("delete from roles where tenant_id=$1", [tenantId]);
  await admin.query("delete from tenants where id=$1", [tenantId]);
  await admin.end();
});

describe("facility billing settings service", () => {
  it("enforces owner authority, creates shared registration and guards open orders", async () => {
    expect((await getClubBillingDefault({ tenantId })).ok).toBe(false);
    const defaultInput = { legalName: "Club legal", legalAddress: address, stateCode: "27", gstin: "27ABCDE1234F1Z5" };
    expect((await saveClubBillingDefault(ctx, defaultInput)).ok).toBe(true);
    const created = await createBillingRegistration(ctx, { legalName: "Site issuer", legalAddress: address, stateCode: "27", gstin: "27ABCDE1234F1Z6" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const choice = { mode: "registered_override" as const, registrationId: created.value.id };
    for (const id of [locationId, otherSite]) {
      const saved = await saveSiteBillingSetting(ctx, { locationId: id, stateCode: "27", choice, enable: true });
      expect(saved.ok).toBe(true);
      if (saved.ok) expect(saved.value.effectiveIssuer?.gstin).toBe("27ABCDE1234F1Z6");
    }
    await admin.query("insert into orders(id,tenant_id,location_id,status,issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_gstin,issuer_registration_mode) values($1,$2,$3,'placed',1,'Site issuer',$4::jsonb,'27','27ABCDE1234F1Z6','registered')", [uuidv7(), tenantId, locationId, JSON.stringify(address)]);
    expect((await saveSiteBillingSetting(ctx, { locationId, stateCode: "27", choice, enable: true })).ok).toBe(true);
    const identical = await createBillingRegistration(ctx, { legalName: "Site issuer", legalAddress: address, stateCode: "27", gstin: "27ABCDE1234F1Z6" });
    expect(identical.ok).toBe(true);
    if (!identical.ok) return;
    expect((await saveSiteBillingSetting(ctx, { locationId, stateCode: "27", choice: { mode: "registered_override", registrationId: identical.value.id }, enable: true })).ok).toBe(true);
    const blocked = await resetSiteBillingSetting(ctx, { locationId });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("open_orders");
    const site = await getSiteBillingSetting(ctx, locationId);
    expect(site.ok && site.value.locationName).toBe("Main");
    const unregistered = await saveSiteBillingSetting(ctx, { locationId: otherSite, stateCode: "27", choice: { mode: "unregistered_override", legalName: "Other", legalAddress: address }, enable: true });
    expect(unregistered.ok && unregistered.value.effectiveIssuer?.gstin).toBeNull();
    const reset = await resetSiteBillingSetting(ctx, { locationId: otherSite });
    expect(reset.ok && reset.value.choice.mode).toBe("inherit");
    expect(reset.ok && reset.value.effectiveIssuer?.gstin).toBe("27ABCDE1234F1Z5");
    await admin.query("insert into orders(id,tenant_id,location_id,status,issuer_snapshot_version,issuer_legal_name,issuer_legal_address,issuer_state_code,issuer_gstin,issuer_registration_mode) values($1,$2,$3,'served',1,'Club legal',$4::jsonb,'27','27ABCDE1234F1Z5','registered')", [uuidv7(), tenantId, otherSite, JSON.stringify(address)]);
    expect((await saveClubBillingDefault(ctx, defaultInput)).ok).toBe(true);
    const blockedDefault = await saveClubBillingDefault(ctx, { ...defaultInput, legalName: "Changed" });
    expect(!blockedDefault.ok && blockedDefault.code).toBe("open_orders");
    const unchanged = await getClubBillingDefault(ctx);
    expect(unchanged.ok && unchanged.value.legalName).toBe("Club legal");
    const mismatch = await createBillingRegistration(ctx, { legalName: "Mismatch", legalAddress: address, stateCode: "29", gstin: "27ABCDE1234F1Z6" });
    expect(!mismatch.ok && mismatch.code).toBe("state_mismatch");
    const missing = await getSiteBillingSetting(ctx, uuidv7());
    expect(!missing.ok && missing.code).toBe("not_found");
    await admin.query("delete from role_permissions where tenant_id=$1 and role_id=$2 and permission_key='settings.manage'", [tenantId, roleId]);
    const denied = await saveClubBillingDefault(ctx, defaultInput);
    expect(!denied.ok && denied.code).toBe("owner_required");
    const audits = await admin.query<{ count: string }>("select count(*)::text as count from audit_log where tenant_id=$1 and action like 'facility_billing.%'", [tenantId]);
    expect(Number(audits.rows[0]?.count)).toBeGreaterThanOrEqual(5);
  });
});
