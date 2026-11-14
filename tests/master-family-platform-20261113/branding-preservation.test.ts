import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getBranding, readBrandingLogo, updateBranding } from "@/lib/services/branding";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f.cleanup(); });

it("preserves a server-created tenant logo reference when the owner edits the name", async () => {
  const digest = "a".repeat(64);
  const logo = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding = $1 where id = $2", [JSON.stringify({ displayName: "Before", accent: "mango", logo }), f.tenantId]);
  const result = await updateBranding(f.context(), { displayName: "After" });
  expect(result.kind).toBe("ok");
  const row = await f.admin.query<{ branding: { displayName: string; logo?: typeof logo } }>("select branding from tenants where id = $1", [f.tenantId]);
  expect(row.rows[0]?.branding).toMatchObject({ displayName: "After", logo });
});

it("rejects client-provided asset keys instead of accepting or silently ignoring them", async () => {
  const result = await updateBranding(f.context(), { displayName: "Tampered", logo: { objectKey: "other-tenant/secret" } } as never);
  expect(result.kind).toBe("error");
});

it("preserves but never exposes a reference from a different tenant", async () => {
  const digest = "b".repeat(64);
  const logo = { objectKey: `tenant-branding/${f.otherTenant}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding = $1 where id = $2", [JSON.stringify({ accent: "mango", logo }), f.tenantId]);
  expect((await updateBranding(f.context(), { displayName: "Tenant A" })).kind).toBe("ok");
  const row = await f.admin.query<{ branding: { logo?: unknown } }>("select branding from tenants where id = $1", [f.tenantId]);
  expect(row.rows[0]?.branding.logo).toEqual(logo);
  expect((await getBranding({ tenantId: f.tenantId })).logoUrl).toBeNull();
  expect(await readBrandingLogo({ tenantId: f.tenantId }, digest)).toBeNull();
});
