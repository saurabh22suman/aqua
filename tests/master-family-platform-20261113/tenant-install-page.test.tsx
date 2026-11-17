import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import TenantInstallPage from "@/app/clubs/[tenantId]/install/page";
const state = vi.hoisted(() => ({ allowed: true, source: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "example.test" }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/services/branding-target", () => ({ readAuthorizedBrandingTarget: async (_id: string, source: string, read: (tx: unknown) => Promise<unknown>) => { state.source = source; return state.allowed ? read({}) : null; } }));
vi.mock("@/lib/services/branding-target-asset", () => ({ readTargetManifestData: async () => ({ name: "Example Club", iconDigest: null }) }));
async function page() { return TenantInstallPage; }
const tenantId = "0190c000-0000-7000-8000-000000000001";
it("renders the credentialed manifest only after target authorization", async () => {
  state.allowed = true;
  const html = renderToStaticMarkup(await (await page())({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve({ source: "member" }) }));
  expect(state.source).toBe("member");
  expect(html).toContain(`/clubs/${tenantId}/manifest.webmanifest?source=member`);
  expect(html).toMatch(/crossorigin="use-credentials"/i);
  expect(html).toContain("Example Club");
});
it("denies unauthorized targets and invalid source", async () => {
  const get = await page(); state.allowed = false;
  await expect(get({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve({ source: "staff" }) })).rejects.toThrow("NOT_FOUND");
  await expect(get({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve({ source: "invalid" }) })).rejects.toThrow("NOT_FOUND");
});
