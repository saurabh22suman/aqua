import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";
import { readTargetLogo as read } from "@/lib/services/branding-target-asset";
import { readTargetIcon } from "@/lib/services/branding-target-asset";
import sharp from "sharp";
import type { ObjectStore } from "@/lib/storage/object-store";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f.cleanup(); });
it("reads only a tenant-bound current digest and rejects missing or tampered bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const logo = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1 where id=any($2::uuid[])", [JSON.stringify({ logo }), [f.tenantId, f.otherTenant]]);
  const store: ObjectStore = { getObject: vi.fn(async () => bytes), putObject: vi.fn(), listObjects: vi.fn(async () => []), deleteObject: vi.fn() };
  expect(await withTenant(f.tenantId, (tx) => read(tx, f.tenantId, digest, store))).toEqual(bytes);
  expect(await withTenant(f.otherTenant, (tx) => read(tx, f.otherTenant, digest, store))).toBeNull();
  expect(await withTenant(f.tenantId, (tx) => read(tx, f.tenantId, "a".repeat(64), store))).toBeNull();
  vi.mocked(store.getObject).mockResolvedValueOnce(new Uint8Array([9]));
  expect(await withTenant(f.tenantId, (tx) => read(tx, f.tenantId, digest, store))).toBeNull();
});
it("derives real icon sizes only from the requested tenant's current canonical blob", async () => {
  const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#000000" } }).png().toBuffer();
  const digest = createHash("sha256").update(bytes).digest("hex");
  const icon = { objectKey: `tenant-branding/${f.tenantId}/install_icon/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1 where id=any($2::uuid[])", [JSON.stringify({ installIcon: icon }), [f.tenantId, f.otherTenant]]);
  const store: ObjectStore = { getObject: vi.fn(async () => bytes), putObject: vi.fn(), listObjects: vi.fn(async () => []), deleteObject: vi.fn() };
  for (const size of [192, 512] as const) {
    const png = await withTenant(f.tenantId, (tx) => readTargetIcon(tx, f.tenantId, digest, size, store));
    expect(png).not.toBeNull();
    const metadata = await sharp(png!).metadata();
    expect([metadata.width, metadata.height]).toEqual([size, size]);
  }
  expect(await withTenant(f.otherTenant, (tx) => readTargetIcon(tx, f.otherTenant, digest, 192, store))).toBeNull();
});
