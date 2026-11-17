import sharp from "sharp";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { getBranding, updateBranding, uploadBrandingAsset } from "@/lib/services/branding";
import { readTargetIcon, readTargetLogo } from "@/lib/services/branding-target-asset";

let f: Awaited<ReturnType<typeof fixture>>;
let a: Buffer;
let b: Buffer;
beforeAll(async () => {
  f = await fixture();
  a = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#123456" } }).png().toBuffer();
  b = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#789abc" } }).png().toBuffer();
});
afterAll(async () => { if (f) await f.cleanup(); });

it("derives 192 and 512 icon variants from the current tenant icon", async () => {
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "install_icon", bytes: a, mime: "image/png" })).toEqual({ ok: true });
  const row = await f.admin.query<{ branding: { installIcon: { sha256: string } } }>("select branding from tenants where id=$1", [f.tenantId]);
  const digest = row.rows[0]!.branding.installIcon.sha256;
  for (const size of [192, 512] as const) {
    const bytes = await withTenant(f.tenantId, (tx) => readTargetIcon(tx, f.tenantId, digest, size));
    expect(bytes).not.toBeNull();
    const meta = await sharp(bytes!).metadata();
    expect([meta.width, meta.height]).toEqual([size, size]);
  }
  expect(await withTenant(f.otherTenant, (tx) => readTargetIcon(tx, f.otherTenant, digest, 192))).toBeNull();
});

it("serializes owner replacements and keeps only one current logo", async () => {
  expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes: a, mime: "image/png" })).toEqual({ ok: true });
  const old = (await getBranding({ tenantId: f.tenantId })).logoUrl!.match(/\/logo\/([a-f0-9]{64})/)![1]!;
  const results = await Promise.all([a, b].map((bytes) => uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes, mime: "image/png" })));
  expect(results).toEqual([{ ok: true }, { ok: true }]);
  const rows = await f.admin.query("select kind from branding_assets where tenant_id=$1 and kind='logo'", [f.tenantId]);
  expect(rows.rowCount).toBe(1);
  const current = (await getBranding({ tenantId: f.tenantId })).logoUrl!.match(/\/logo\/([a-f0-9]{64})/)![1]!;
  expect(await withTenant(f.tenantId, (tx) => readTargetLogo(tx, f.tenantId, current))).not.toBeNull();
  if (current !== old) expect(await withTenant(f.tenantId, (tx) => readTargetLogo(tx, f.tenantId, old))).toBeNull();
});

it("rejects non-owner uploads without changing branding", async () => {
  const before = await getBranding({ tenantId: f.tenantId });
  expect(await uploadBrandingAsset({ ctx: f.context(f.managerId, "manager"), kind: "logo", bytes: b, mime: "image/png" })).toEqual({ ok: false });
  expect(await getBranding({ tenantId: f.tenantId })).toEqual(before);
});

it("denies a foreign tenant and a revoked owner without writes", async () => {
  const foreign = { ...f.context(), tenantId: f.otherTenant };
  expect(await uploadBrandingAsset({ ctx: foreign, kind: "logo", bytes: b, mime: "image/png" })).toEqual({ ok: false });
  await f.admin.query("update tenant_memberships set status='revoked' where id=$1", [f.membershipId]);
  try {
    expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes: b, mime: "image/png" })).toEqual({ ok: false });
  } finally { await f.admin.query("update tenant_memberships set status='active' where id=$1", [f.membershipId]); }
});

it("rolls back replaced bytes and reference if the audit insert fails", async () => {
  const before = await f.admin.query("select branding from tenants where id=$1", [f.tenantId]);
  const assets = await f.admin.query("select kind,sha256,png from branding_assets where tenant_id=$1 order by kind", [f.tenantId]);
  const audits = await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId]);
  await f.admin.query(`create function public.test_branding_audit_failure() returns trigger language plpgsql as $$ begin if new.tenant_id = '${f.tenantId}'::uuid and new.action = 'branding.asset.update' then raise exception 'synthetic audit failure'; end if; return new; end $$`);
  await f.admin.query("create trigger test_branding_audit_failure before insert on audit_log for each row execute function public.test_branding_audit_failure()");
  try {
    expect(await uploadBrandingAsset({ ctx: f.context(), kind: "logo", bytes: b, mime: "image/png" })).toEqual({ ok: false });
    expect((await f.admin.query("select branding from tenants where id=$1", [f.tenantId])).rows).toEqual(before.rows);
    expect((await f.admin.query("select kind,sha256,png from branding_assets where tenant_id=$1 order by kind", [f.tenantId])).rows).toEqual(assets.rows);
    expect((await f.admin.query("select count(*)::int n from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId])).rows).toEqual(audits.rows);
  } finally {
    await f.admin.query("drop trigger test_branding_audit_failure on audit_log");
    await f.admin.query("drop function public.test_branding_audit_failure()");
  }
});

it("refuses unmigrated and malformed references without erasing them", async () => {
  const g = await fixture();
  try {
    const digest = "a".repeat(64);
    for (const logo of [{ objectKey: `tenant-branding/${g.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" }, { invalid: true }]) {
      await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
      expect(await uploadBrandingAsset({ ctx: g.context(), kind: "install_icon", bytes: a, mime: "image/png" })).toEqual({ ok: false });
      expect((await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0]?.branding).toEqual({ logo });
    }
  } finally { await g.cleanup(); }
});

it("allows replacing a logo while an unrelated current icon has corrupt bytes", async () => {
  const g = await fixture();
  try {
    expect(await uploadBrandingAsset({ ctx: g.context(), kind: "install_icon", bytes: a, mime: "image/png" })).toEqual({ ok: true });
    const before = (await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0]!.branding.installIcon;
    await g.admin.query("update branding_assets set png=$2 where tenant_id=$1 and kind='install_icon'", [g.tenantId, b]);
    expect(await uploadBrandingAsset({ ctx: g.context(), kind: "logo", bytes: a, mime: "image/png" })).toEqual({ ok: true });
    expect((await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0]!.branding.installIcon).toEqual(before);
    expect(await withTenant(g.tenantId, (tx) => readTargetIcon(tx, g.tenantId, before.sha256, 192))).toBeNull();
  } finally { await g.cleanup(); }
});

it("does not discard malformed legacy references when editing branding text", async () => {
  const g = await fixture();
  try {
    const logo = { invalid: true };
    await g.admin.query("update tenants set branding=$2 where id=$1", [g.tenantId, JSON.stringify({ logo })]);
    await updateBranding(g.context(), { displayName: "Synthetic name" });
    expect((await g.admin.query("select branding from tenants where id=$1", [g.tenantId])).rows[0]?.branding.logo).toEqual(logo);
  } finally { await g.cleanup(); }
});
