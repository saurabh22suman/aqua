import { expect, it, vi } from "vitest";
import { GET } from "@/app/clubs/[tenantId]/manifest.webmanifest/route";
const state = vi.hoisted(() => ({ allowed: true, source: "" }));
vi.mock("@/lib/services/branding-target", () => ({ readAuthorizedBrandingTarget: async (_tenant: string, source: string, read: (tx: unknown) => Promise<unknown>) => { state.source = source; return state.allowed ? read({}) : null; } }));
vi.mock("@/lib/services/branding-target-asset", () => ({ readTargetManifestData: async () => ({ name: "Example club", iconDigest: "a".repeat(64) }) }));
async function route() { return GET; }
const tenantId = "0190c000-0000-7000-8000-000000000001", context = { params: Promise.resolve({ tenantId }) };
it("serves a private authorized manifest with a role-agnostic stable UUID identity", async () => {
  state.allowed = true;
  const res = await (await route())(new Request(`https://example.test/clubs/${tenantId}/manifest.webmanifest?source=member`), context);
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toMatch(/private.*no-store/i);
  expect(state.source).toBe("member");
  expect(await res.json()).toMatchObject({ id: `/clubs/${tenantId}/install`, start_url: `/clubs/${tenantId}/launch` });
});
it("refuses invalid source, Ops and unauthorized requests", async () => {
  const get = await route();
  expect((await get(new Request(`https://example.test/clubs/${tenantId}/manifest.webmanifest?source=unknown`), context)).status).toBe(404);
  expect((await get(new Request(`http://ops.localhost/clubs/${tenantId}/manifest.webmanifest?source=staff`), context)).status).toBe(404);
  state.allowed = false;
  expect((await get(new Request(`https://example.test/clubs/${tenantId}/manifest.webmanifest?source=staff`), context)).status).toBe(404);
});
