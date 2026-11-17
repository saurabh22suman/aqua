import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getBranding, readBrandingLogo, uploadBrandingAsset } from "@/lib/services/branding";
import { isObjectStoreEnabled } from "@/lib/storage/object-store";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => {
  if (!f) return;
  const table = await f.admin.query("select to_regclass('public.branding_assets') as name");
  if (table.rows[0]?.name) await f.admin.query("delete from branding_assets where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("persists and reads a real owner logo without generic R2 configuration", async () => {
  expect(isObjectStoreEnabled()).toBe(false);
  const bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: true });
  const branding = await getBranding({ tenantId: f.tenantId });
  const digest = branding.logoUrl?.match(/\/logo\/([a-f0-9]{64})\?/)?.[1];
  expect(digest).toBeDefined();
  const stored = await readBrandingLogo({ tenantId: f.tenantId }, digest!);
  expect(stored).not.toBeNull();
  expect((await sharp(stored!).metadata()).format).toBe("png");
});

it("allows the owner to replace a corrupted current logo without altering the icon reference", async () => {
  const icon = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#467890" } }).png().toBuffer();
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "install_icon", bytes: icon, mime: "image/png" })).toEqual({ ok: true });
  const before = await f.admin.query<{ branding: { installIcon: unknown } }>("select branding from tenants where id=$1", [f.tenantId]);
  await f.admin.query("update branding_assets set png=$2 where tenant_id=$1 and kind='logo'", [f.tenantId, icon]);
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes: icon, mime: "image/png" })).toEqual({ ok: true });
  const after = await f.admin.query<{ branding: { installIcon: unknown } }>("select branding from tenants where id=$1", [f.tenantId]);
  expect(after.rows[0]?.branding.installIcon).toEqual(before.rows[0]?.branding.installIcon);
});
