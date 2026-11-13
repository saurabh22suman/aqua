import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { fixture } from "@/tests/remediation-20261112/fixture";
import * as branding from "@/lib/services/branding";
import type { ActionCtx } from "@/lib/auth/context";
import type { ObjectStore } from "@/lib/storage/object-store";

type Upload = (input: { ctx: ActionCtx; kind: "logo" | "install_icon"; bytes: Uint8Array; mime: string; store: ObjectStore }) => Promise<{ ok: boolean }>;
const upload: Upload = (branding as unknown as { uploadBrandingAsset?: Upload }).uploadBrandingAsset ?? (async () => ({ ok: false }));
let f: Awaited<ReturnType<typeof fixture>>;
let bytes: Uint8Array;
beforeAll(async () => { f = await fixture(); bytes = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#000000" } }).png().toBuffer(); });
afterAll(async () => { await f.cleanup(); });
function store() {
  return { putObject: vi.fn<ObjectStore["putObject"]>(async () => {}), getObject: vi.fn(async () => null), listObjects: vi.fn(async () => []), deleteObject: vi.fn(async () => {}) };
}
it("stores a server-keyed logo and audits the owner update", async () => {
  const objectStore = store();
  const result = await upload({ ctx: f.context(), kind: "logo", bytes, mime: "image/png", store: objectStore });
  expect(result.ok).toBe(true);
  expect(objectStore.putObject).toHaveBeenCalledTimes(1);
  const key = objectStore.putObject.mock.calls[0]?.[0];
  expect(key).toMatch(new RegExp(`^tenant-branding/${f.tenantId}/logo/[a-f0-9]{64}\\.png$`));
  const row = await f.admin.query<{ branding: { logo: { objectKey: string } } }>("select branding from tenants where id=$1", [f.tenantId]);
  expect(row.rows[0]?.branding.logo.objectKey).toBe(key);
  const audit = await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId]);
  expect(audit.rowCount).toBe(1);
});
it("rejects a non-owner before writing to storage", async () => {
  const objectStore = store();
  expect((await upload({ ctx: f.context(f.managerId, "manager"), kind: "logo", bytes, mime: "image/png", store: objectStore })).ok).toBe(false);
  expect(objectStore.putObject).not.toHaveBeenCalled();
});
it("does not publish or audit an asset when storage fails", async () => {
  const before = await f.admin.query<{ branding: unknown }>("select branding from tenants where id=$1", [f.tenantId]);
  const count = await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId]);
  const objectStore = store();
  objectStore.putObject.mockRejectedValueOnce(new Error("synthetic storage failure"));
  expect((await upload({ ctx: f.context(), kind: "install_icon", bytes, mime: "image/png", store: objectStore })).ok).toBe(false);
  const after = await f.admin.query<{ branding: unknown }>("select branding from tenants where id=$1", [f.tenantId]);
  const afterCount = await f.admin.query("select 1 from audit_log where tenant_id=$1 and action='branding.asset.update'", [f.tenantId]);
  expect(after.rows[0]?.branding).toEqual(before.rows[0]?.branding);
  expect(afterCount.rowCount).toBe(count.rowCount);
});
