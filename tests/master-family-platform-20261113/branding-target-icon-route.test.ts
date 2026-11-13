import { expect, it, vi } from "vitest";
import { GET } from "@/app/clubs/[tenantId]/icon/[digest]/[size]/route";
const state = vi.hoisted(() => ({ source: "", size: 0, allowed: true }));
vi.mock("@/lib/services/branding-target", () => ({ readAuthorizedBrandingTarget: async (_tenant: string, source: string, read: (tx: unknown) => Promise<unknown>) => {
  state.source = source; return state.allowed ? read({}) : null;
} }));
vi.mock("@/lib/services/branding-target-asset", () => ({ readTargetIcon: async (_tx: unknown, _tenant: string, _digest: string, size: number) => { state.size = size; return new Uint8Array([1]); } }));
async function route() { return GET; }
const tenantId = "0190c000-0000-7000-8000-000000000001", digest = "a".repeat(64);
it.each(["192", "512"])("returns a private target-bound %s icon", async (size) => {
  state.allowed = true;
  const response = await (await route())(new Request(`https://example.test/clubs/${tenantId}/icon/${digest}/${size}?source=guardian`), { params: Promise.resolve({ tenantId, digest, size }) });
  expect(response.status).toBe(200);
  expect([state.source, state.size]).toEqual(["guardian", Number(size)]);
  expect(response.headers.get("cache-control")).toMatch(/private.*no-store/i);
});
it("fails closed for invalid size, missing source, ops host and denied access", async () => {
  const get = await route();
  const params = (size: string) => ({ params: Promise.resolve({ tenantId, digest, size }) });
  expect((await get(new Request(`https://example.test/clubs/${tenantId}/icon/${digest}/999?source=staff`), params("999"))).status).toBe(404);
  expect((await get(new Request(`https://example.test/clubs/${tenantId}/icon/${digest}/192`), params("192"))).status).toBe(404);
  expect((await get(new Request(`http://ops.localhost/clubs/${tenantId}/icon/${digest}/192?source=staff`), params("192"))).status).toBe(404);
  state.allowed = false;
  expect((await get(new Request(`https://example.test/clubs/${tenantId}/icon/${digest}/192?source=staff`), params("192"))).status).toBe(404);
});
