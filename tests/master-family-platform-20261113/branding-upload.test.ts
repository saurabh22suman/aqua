import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { uploadBrandingAsset } from "@/lib/services/branding";

let f: Awaited<ReturnType<typeof fixture>>;
let bytes: Buffer;
beforeAll(async () => { f = await fixture(); bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#000000" } }).png().toBuffer(); });
afterAll(async () => { await f.cleanup(); });
it("stores a server-keyed logo and audits the owner update", async () => {
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: true });
  const row = await f.admin.query<{ branding: { logo: { objectKey: string; sha256: string } } }>("select branding from tenants where id=$1", [f.tenantId]);
  const logo = row.rows[0]!.branding.logo;
  expect(logo.objectKey).toMatch(new RegExp(`^tenant-branding/${f.tenantId}/logo/[a-f0-9]{64}\\.png$`));
  const asset = await f.admin.query("select 1 from branding_assets where tenant_id=$1 and kind='logo' and sha256=$2", [f.tenantId, logo.sha256]);
  expect(asset.rowCount).toBe(1);
  expect((await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId])).rowCount).toBe(1);
});
it("rejects a non-owner before writing to storage", async () => {
  const before = await f.admin.query("select kind,sha256 from branding_assets where tenant_id=$1", [f.tenantId]);
  expect(await uploadBrandingAsset({ ctx: f.context(f.managerId, "manager"), kind: "logo", bytes, mime: "image/png" })).toEqual({ ok: false });
  expect((await f.admin.query("select kind,sha256 from branding_assets where tenant_id=$1", [f.tenantId])).rows).toEqual(before.rows);
});
it("does not publish or audit an asset when storage fails", async () => {
  const before = await f.admin.query("select branding from tenants where id=$1", [f.tenantId]);
  const count = await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId]);
  await f.admin.query(`create function public.test_branding_asset_failure() returns trigger language plpgsql as $$ begin if new.tenant_id = '${f.tenantId}'::uuid then raise exception 'synthetic asset failure'; end if; return new; end $$`);
  await f.admin.query("create trigger test_branding_asset_failure before insert on branding_assets for each row execute function public.test_branding_asset_failure()");
  try {
    expect(await uploadBrandingAsset({ ctx: f.context(), kind: "install_icon", bytes, mime: "image/png" })).toEqual({ ok: false });
    expect((await f.admin.query("select branding from tenants where id=$1", [f.tenantId])).rows).toEqual(before.rows);
    expect((await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId])).rowCount).toBe(count.rowCount);
    expect((await f.admin.query("select 1 from branding_assets where tenant_id=$1 and kind='install_icon'", [f.tenantId])).rowCount).toBe(0);
  } finally {
    await f.admin.query("drop trigger test_branding_asset_failure on branding_assets");
    await f.admin.query("drop function public.test_branding_asset_failure()");
  }
});
