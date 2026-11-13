import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../remediation-20261112/fixture";
import { moduleForPermission } from "@/lib/auth/permission";

const request = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/auth/context", async (original) => ({ ...(await original<typeof import("@/lib/auth/context")>()), requireDefaultCtx: request.context }));
import { getMemberPayerAction } from "@/lib/actions/people";

let f: Awaited<ReturnType<typeof fixture>>;
const otherPerson = randomUUID(), otherMember = randomUUID();
beforeAll(async () => {
  f = await fixture();
  await f.admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Other facility')", [otherPerson, f.tenantId]);
  await f.admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','OTHER')", [otherMember, f.tenantId, otherPerson, f.locationB]);
});
afterAll(async () => { if (f) { await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]); await f.cleanup(); } });

it.each([false, true])("enforces scope through the actual payer action with legacy switch %s", async (enabled) => {
  await f.admin.query("delete from config_values where tenant_id=$1 and key='access.location_scoped_staff'", [f.tenantId]);
  if (enabled) await f.admin.query("insert into config_values(id,key,scope_type,scope_id,tenant_id,value) values($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true'::jsonb)", [randomUUID(), f.tenantId]);
  const ctx = f.context(f.managerId, "manager");
  ctx.permissions.add("invoices.read");
  ctx.features.add(moduleForPermission("invoices.read")!);
  request.context.mockResolvedValue(ctx);
  expect(await getMemberPayerAction(f.memberId)).not.toBeNull();
  expect(await getMemberPayerAction(otherMember)).toBeNull();
  const owner = f.context(); owner.permissions.add("invoices.read"); owner.features.add(moduleForPermission("invoices.read")!);
  request.context.mockResolvedValue(owner);
  expect(await getMemberPayerAction(otherMember)).not.toBeNull();
});
