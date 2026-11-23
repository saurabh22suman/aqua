import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { GET } from "@/app/clubs/[tenantId]/branding/logo/[digest]/route";

const state = vi.hoisted(() => ({ allowed: true, requested: "", source: "", bytes: new Uint8Array([1, 2, 3]) }));
vi.mock("@/lib/services/branding-target", () => ({
  readAuthorizedBrandingTarget: async (tenant: string, source: string, read: (tx: unknown) => Promise<unknown>) => {
    state.requested = tenant; state.source = source;
    return state.allowed ? read({}) : null;
  },
}));
vi.mock("@/lib/services/branding-target-asset", () => ({
  readTargetLogo: async () => state.bytes,
}));
async function route() { return GET; }
const tenant = "0190c000-0000-7000-8000-000000000001";
const digest = createHash("sha256").update(new Uint8Array([1, 2, 3])).digest("hex");
const context = { params: Promise.resolve({ tenantId: tenant, digest }) };
it.each(["staff", "member", "guardian"])("serves %s only through requested target authorization and private no-store", async (source) => {
  state.allowed = true;
  const res = await (await route())(new Request(`https://example.test/clubs/${tenant}/branding/logo/${digest}?source=${source}`), context);
  expect(res.status).toBe(200);
  expect([state.requested, state.source]).toEqual([tenant, source]);
  expect(res.headers.get("cache-control")).toMatch(/private.*no-store/i);
});
it("denies missing source, Ops host and unauthorized target generically", async () => {
  const get = await route();
  expect((await get(new Request(`https://example.test/clubs/${tenant}/branding/logo/${digest}`), context)).status).toBe(404);
  expect((await get(new Request(`http://ops.localhost/clubs/${tenant}/branding/logo/${digest}?source=staff`), context)).status).toBe(404);
  state.allowed = false;
  const res = await get(new Request(`https://example.test/clubs/${tenant}/branding/logo/${digest}?source=staff`), context);
  expect(res.status).toBe(404);
  expect(res.headers.get("cache-control")).toMatch(/no-store/i);
});
