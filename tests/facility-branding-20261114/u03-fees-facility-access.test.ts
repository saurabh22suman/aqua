import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { canSelectFacility } from "@/lib/services/selected-facility-access";

let f: Awaited<ReturnType<typeof fixture>>;
const foreign = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$2,'Foreign',true)", [foreign, f.otherTenant]);
});
afterAll(async () => { if (f) await f.cleanup(); });

it("accepts only a live same-tenant facility within the live membership scope", async () => {
  const ctx = f.context(f.managerId, "manager");
  expect(await canSelectFacility(ctx, f.locationA)).toBe(true);
  expect(await canSelectFacility(ctx, f.locationB)).toBe(false);
  expect(await canSelectFacility(ctx, foreign)).toBe(false);
  expect(await canSelectFacility(ctx, randomUUID())).toBe(false);
  await f.admin.query("update locations set deleted_at=now() where id=$1", [f.locationA]);
  try { expect(await canSelectFacility(ctx, f.locationA)).toBe(false); }
  finally { await f.admin.query("update locations set deleted_at=null where id=$1", [f.locationA]); }
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.managerMembership]);
  try { expect(await canSelectFacility(ctx, f.locationA)).toBe(false); }
  finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.managerMembership]); }
});
