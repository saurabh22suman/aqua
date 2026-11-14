import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ authorized: true, bytes: new Uint8Array([1, 2, 3]) as Uint8Array | null }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => { if (!state.authorized) throw new Error("denied"); return { tenantId: "tenant-a" }; } }));
vi.mock("@/lib/services/branding-asset-read", () => ({ readBrandingLogo: async () => state.bytes }));

async function getRoute() {
  const path = "@/app/api/branding/logo/route";
  try { return (await import(/* @vite-ignore */ path)).GET as (request: Request) => Promise<Response>; }
  catch { return async () => new Response("Not found", { status: 404 }); }
}
it("serves an authorized current logo privately, never from a shared cache", async () => {
  state.authorized = true; state.bytes = new Uint8Array([1, 2, 3]);
  const get = await getRoute();
  const response = await get(new Request(`https://example.test/api/branding/logo?v=${"a".repeat(64)}`));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toMatch(/private.*no-store/i);
  expect(response.headers.get("content-type")).toContain("image/png");
});
it("returns the same no-store 404 for denied or unavailable assets", async () => {
  const get = await getRoute();
  state.authorized = false;
  const denied = await get(new Request(`https://example.test/api/branding/logo?v=${"a".repeat(64)}`));
  state.authorized = true; state.bytes = null;
  const missing = await get(new Request(`https://example.test/api/branding/logo?v=${"a".repeat(64)}`));
  expect(denied.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(denied.headers.get("cache-control")).toMatch(/no-store/i);
  expect(missing.headers.get("cache-control")).toMatch(/no-store/i);
});
