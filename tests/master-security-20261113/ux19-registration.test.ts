import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../remediation-20261112/fixture";
import { createMember } from "@/lib/services/register";
import { CURRENT_POLICY_VERSION } from "@/lib/schemas";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from guardianships where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("refuses a future birth date in the registration service before consent or person writes", async () => {
  const before = await f.admin.query("select count(*)::int n from persons where tenant_id=$1", [f.tenantId]);
  const result = await createMember(f.context(), {
    fullName: "Synthetic future date", dateOfBirth: "2099-01-01", locationId: f.locationA,
    memberCode: "FUTURE", guardian: { fullName: "Synthetic guardian", relationship: "parent" },
    consents: [{ purpose: "processing", policyVersion: CURRENT_POLICY_VERSION, evidence: { channel: "test" } }],
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/birth.*future/i) }));
  const after = await f.admin.query("select count(*)::int n from persons where tenant_id=$1", [f.tenantId]);
  expect(after.rows[0].n).toBe(before.rows[0].n);
});
