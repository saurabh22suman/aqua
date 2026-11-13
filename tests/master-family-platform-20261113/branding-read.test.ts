import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import { getBranding } from "@/lib/services/branding";
import * as branding from "@/lib/services/branding";
import type { ObjectStore } from "@/lib/storage/object-store";
let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => { f = await fixture(); });
afterAll(async () => { await f.cleanup(); });
it("exposes a same-origin URL only for an asset bound to the selected tenant", async () => {
  const digest = "c".repeat(64);
  const logo = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1 where id=$2", [JSON.stringify({ logo }), f.tenantId]);
  const own = await getBranding({ tenantId: f.tenantId }) as unknown as { logoUrl?: string | null };
  expect(own.logoUrl).toBe(`/clubs/${f.tenantId}/branding/logo/${digest}?source=staff`);
  await f.admin.query("update tenants set branding=$1 where id=$2", [JSON.stringify({ logo }), f.otherTenant]);
  const other = await getBranding({ tenantId: f.otherTenant }) as unknown as { logoUrl?: string | null };
  expect(other.logoUrl ?? null).toBeNull();
});

it("only serves the selected tenant's current asset version", async () => {
  const digest = "d".repeat(64);
  const logo = { objectKey: `tenant-branding/${f.tenantId}/logo/${digest}.png`, sha256: digest, contentType: "image/png" };
  await f.admin.query("update tenants set branding=$1 where id=$2", [JSON.stringify({ logo }), f.tenantId]);
  const bytes = new Uint8Array([1, 2, 3]);
  const store: ObjectStore = { putObject: vi.fn(), getObject: vi.fn(async () => bytes), listObjects: vi.fn(async () => []), deleteObject: vi.fn() };
  type Read = (ctx: { tenantId: typeof f.tenantId }, digest: string, store: ObjectStore) => Promise<Uint8Array | null>;
  const read = (branding as unknown as { readBrandingLogo?: Read }).readBrandingLogo ?? (async () => null);
  expect(await read({ tenantId: f.tenantId }, digest, store)).toEqual(bytes);
  expect(await read({ tenantId: f.tenantId }, "e".repeat(64), store)).toBeNull();
  expect(await read({ tenantId: f.otherTenant }, digest, store)).toBeNull();
});
