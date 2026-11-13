import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getOnboardingChecklist } from "@/lib/services/onboarding-checklist";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  for (const key of ["members.read", "members.write", "programs.read", "programs.write", "staff.read"]) {
    await f.admin.query("insert into role_permissions (tenant_id, role_id, permission_key) values ($1, $2, $3) on conflict (tenant_id, role_id, permission_key) do nothing", [f.tenantId, f.roleId, key]);
  }
  await f.admin.query("delete from role_permissions where tenant_id = $1 and role_id = $2 and permission_key = 'members.read'", [f.tenantId, f.context(f.managerId, "manager").roleId]);
});
afterAll(async () => { await f.cleanup(); });
it("fails closed without a caller identity or for an ungranted manager", async () => {
  expect((await getOnboardingChecklist({ tenantId: f.tenantId })).items).toEqual([]);
  expect((await getOnboardingChecklist(f.context(f.managerId, "manager"))).items).toEqual([]);
});
it("returns the full checklist and authorized actions for a live owner", async () => {
  const ctx = f.context();
  ctx.permissions = new Set(["members.read", "members.write", "programs.read", "programs.write", "staff.read"]);
  ctx.features = new Set(["members", "programs", "staff", "settings"]);
  const result = await getOnboardingChecklist(ctx);
  expect(result.items.map((item) => item.key)).toEqual(["add_members", "create_batch", "assign_coach"]);
  expect(result.items.every((item) => item.cta)).toBe(true);
  expect(result.items.every((item) => item.complete)).toBe(true);
});
it("refuses a revoked owner even when the supplied context still claims owner grants", async () => {
  const ctx = f.context();
  await f.admin.query("update tenant_memberships set deleted_at = now() where id = $1", [f.membershipId]);
  try {
    expect((await getOnboardingChecklist(ctx)).items).toEqual([]);
  } finally {
    await f.admin.query("update tenant_memberships set deleted_at = null where id = $1", [f.membershipId]);
  }
});
it("does not trust forged owner role and permissions for a non-owner", async () => {
  const ctx = { ...f.context(f.managerId, "manager"), roleKey: "owner", allLocations: true,
    permissions: new Set(["members.read", "members.write", "programs.read", "programs.write", "staff.read"]),
    features: new Set(["members", "programs", "staff", "settings"]) };
  expect((await getOnboardingChecklist(ctx)).items).toEqual([]);
});
