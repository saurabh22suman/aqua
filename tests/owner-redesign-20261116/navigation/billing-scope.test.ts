import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getSiteBillingSetting, resetSiteBillingSetting, saveSiteBillingSetting } from "@/lib/services/facility-billing-settings";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update tenant_memberships set all_locations=false where id=$1", [f.membershipId]);
  await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), f.tenantId, f.membershipId, f.locationA]);
});
afterAll(async () => { await f?.cleanup(); });

describe("facility billing location boundary", () => {
  it("returns only the live owner's named site, even when context claims all sites", async () => {
    expect((await getSiteBillingSetting(f.context(), f.locationA)).ok).toBe(true);
    expect(await getSiteBillingSetting(f.context(), f.locationB)).toMatchObject({ ok: false, code: "not_found" });
    expect(await getSiteBillingSetting(f.context(), randomUUID())).toMatchObject({ ok: false, code: "not_found" });
  });
  it("does not save or reset a site outside the owner's membership", async () => {
    const input = { locationId: f.locationB, stateCode: "27", choice: { mode: "inherit" }, enable: false };
    const before = await f.admin.query("select count(*)::int as n from audit_log where tenant_id=$1 and action='facility_billing.site.update'", [f.tenantId]);
    expect(await saveSiteBillingSetting(f.context(), input)).toMatchObject({ ok: false, code: "not_found" });
    expect(await resetSiteBillingSetting(f.context(), { locationId: f.locationB })).toMatchObject({ ok: false, code: "not_found" });
    const after = await f.admin.query("select count(*)::int as n from audit_log where tenant_id=$1 and action='facility_billing.site.update'", [f.tenantId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
  it("allows an authorized facility mutation and commits its audit", async () => {
    const input = { locationId: f.locationA, stateCode: "27", choice: { mode: "inherit" }, enable: false };
    expect((await saveSiteBillingSetting(f.context(), input)).ok).toBe(true);
    const rows = await f.admin.query("select id from audit_log where tenant_id=$1 and entity_id=$2 and action='facility_billing.site.update'", [f.tenantId, f.locationA]);
    expect(rows.rowCount).toBe(1);
  });
  it("rejects a revoked owner even for a formerly authorized facility", async () => {
    await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
    try { expect((await getSiteBillingSetting(f.context(), f.locationA)).ok).toBe(false); }
    finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
  });
});
