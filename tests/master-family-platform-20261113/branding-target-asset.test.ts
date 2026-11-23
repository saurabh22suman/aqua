import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { readTargetIcon, readTargetLogo } from "@/lib/services/branding-target-asset";
import { uploadBrandingAsset } from "@/lib/services/branding";
import sharp from "sharp";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f.cleanup(); });
it("reads only a tenant-bound current digest and rejects missing or tampered bytes", async () => {
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: true });
  const row = await f.admin.query<{ branding: { logo: { sha256: string } } }>("select branding from tenants where id=$1", [f.tenantId]);
  const digest = row.rows[0]!.branding.logo.sha256;
  expect(await withTenant(f.tenantId, (tx) => readTargetLogo(tx, f.tenantId, digest))).not.toBeNull();
  expect(await withTenant(f.otherTenant, (tx) => readTargetLogo(tx, f.otherTenant, digest))).toBeNull();
  expect(await withTenant(f.tenantId, (tx) => readTargetLogo(tx, f.tenantId, "a".repeat(64)))).toBeNull();
  const other = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#abcdef" } }).png().toBuffer();
  await f.admin.query("update branding_assets set png=$2 where tenant_id=$1 and kind='logo'", [f.tenantId, other]);
  expect(await withTenant(f.tenantId, (tx) => readTargetLogo(tx, f.tenantId, digest))).toBeNull();
});
it("derives real icon sizes only from the requested tenant's current canonical blob", async () => {
  const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#000000" } }).png().toBuffer();
  // Use a new fixture so the intentionally corrupted logo in the preceding test is irrelevant.
  const g = await fixture();
  try {
    expect(await uploadBrandingAsset({ ctx: g.context(), kind: "install_icon", bytes, mime: "image/png" })).toEqual({ ok: true });
    const row = await g.admin.query<{ branding: { installIcon: { sha256: string } } }>("select branding from tenants where id=$1", [g.tenantId]);
    const digest = row.rows[0]!.branding.installIcon.sha256;
    for (const size of [192, 512] as const) {
      const png = await withTenant(g.tenantId, (tx) => readTargetIcon(tx, g.tenantId, digest, size));
      expect(png).not.toBeNull();
      const metadata = await sharp(png!).metadata();
      expect([metadata.width, metadata.height]).toEqual([size, size]);
    }
    expect(await withTenant(g.otherTenant, (tx) => readTargetIcon(tx, g.otherTenant, digest, 192))).toBeNull();
  } finally { await g.cleanup(); }
});
