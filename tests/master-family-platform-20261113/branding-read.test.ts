import { afterAll, beforeAll, expect, it } from "vitest";
import sharp from "sharp";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getBranding, readBrandingLogo, uploadBrandingAsset } from "@/lib/services/branding";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f.cleanup(); });
it("exposes a same-origin URL only for an asset bound to the selected tenant", async () => {
  const digest = "c".repeat(64);
  const logo = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1 where id=$2", [JSON.stringify({ logo }), f.tenantId]);
  expect((await getBranding({ tenantId: f.tenantId })).logoUrl).toBe(`/clubs/${f.tenantId}/branding/logo/${digest}?source=staff`);
  await f.admin.query("update tenants set branding=$1 where id=$2", [JSON.stringify({ logo }), f.otherTenant]);
  expect((await getBranding({ tenantId: f.otherTenant })).logoUrl ?? null).toBeNull();
});
it("only serves the selected tenant's current asset version", async () => {
  const g = await fixture();
  try {
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
    expect(await uploadBrandingAsset({ ctx: g.context(), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: true });
    const url = (await getBranding({ tenantId: g.tenantId })).logoUrl!;
    const digest = url.match(/\/logo\/([a-f0-9]{64})/)![1]!;
    expect(await readBrandingLogo({ tenantId: g.tenantId }, digest)).not.toBeNull();
    expect(await readBrandingLogo({ tenantId: g.tenantId }, "e".repeat(64))).toBeNull();
    expect(await readBrandingLogo({ tenantId: g.otherTenant }, digest)).toBeNull();
  } finally { await g.cleanup(); }
});
