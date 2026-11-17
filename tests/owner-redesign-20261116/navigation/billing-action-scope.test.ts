import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "@/tests/remediation-20261112/fixture";
const request = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => request.ctx }));
import { getSiteBillingSettingAction, resetSiteBillingSettingAction, saveSiteBillingSettingAction } from "@/lib/actions/facility-billing";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("update tenant_memberships set all_locations=false where id=$1", [f.membershipId]);
  await f.admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), f.tenantId, f.membershipId, f.locationA]);
  request.ctx = f.context();
});
afterAll(async () => { await f?.cleanup(); });
it("rejects out-of-scope direct action reads and mutations", async () => {
  expect(await getSiteBillingSettingAction(f.locationA)).toMatchObject({ ok: true });
  expect(await getSiteBillingSettingAction(f.locationB)).toMatchObject({ ok: false, code: "not_found" });
  expect(await saveSiteBillingSettingAction({ locationId: f.locationB, stateCode: "27", choice: { mode: "inherit" }, enable: false })).toMatchObject({ ok: false, code: "not_found" });
  expect(await resetSiteBillingSettingAction({ locationId: f.locationB })).toMatchObject({ ok: false, code: "not_found" });
});
