import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import TenantLaunchPage from "@/app/clubs/[tenantId]/launch/page";
const state = vi.hoisted(() => ({ allowed: new Set<string>(), names: new Map<string, string>() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/services/branding-target", () => ({ readAuthorizedBrandingTarget: async (id: string, source: string) => state.allowed.has(source) && state.names.has(id) ? { name: state.names.get(id) } : null }));
vi.mock("@/lib/services/branding-target-asset", () => ({ readTargetManifestData: async () => null }));
async function page() { return TenantLaunchPage; }
const tenantId = "0190c000-0000-7000-8000-000000000001", params = Promise.resolve({ tenantId });
it("offers explicit authorized views without silently switching clubs", async () => {
  state.allowed = new Set(["staff", "guardian"]);
  state.names.set(tenantId, "Example Club");
  const html = renderToStaticMarkup(await (await page())({ params }));
  expect(html).toContain("Example Club");
  expect(html).toContain('href="/clubs"');
  expect(html).toContain('href="/family"');
  expect(html).not.toContain('href="/member"');
});
it("shows only the authorized target name, including a long club name", async () => {
  state.allowed = new Set(["member"]);
  const first = "A Very Long Synthetic Club Name In The East";
  const secondId = "0190c000-0000-7000-8000-000000000002";
  state.names.set(tenantId, first);
  state.names.set(secondId, "Another Club");
  const html = renderToStaticMarkup(await (await page())({ params }));
  expect(html).toContain(first);
  expect(html).not.toContain("Another Club");
  const other = renderToStaticMarkup(await (await page())({ params: Promise.resolve({ tenantId: secondId }) }));
  expect(other).toContain("Another Club");
  expect(other).not.toContain("A Very Long Synthetic Club Name In The East");
});
it("offers sign-in recovery without private branding when no source remains authorized", async () => {
  state.allowed = new Set();
  const html = renderToStaticMarkup(await (await page())({ params }));
  expect(html).toContain('href="/login"');
  expect(html).not.toContain('href="/family"');
});
