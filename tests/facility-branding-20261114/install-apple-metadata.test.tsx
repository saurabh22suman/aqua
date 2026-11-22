import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ host: "club.localhost", allowed: true, name: "Synthetic Club", digest: "a".repeat(64), authorized: vi.fn(), read: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: state.host }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/services/branding-target", () => ({ readAuthorizedBrandingTarget: state.authorized }));
vi.mock("@/lib/services/branding-target-asset", () => ({ readTargetManifestData: state.read }));
import * as page from "@/app/clubs/[tenantId]/install/page";

const tenant = "0190c000-0000-7000-8000-000000000001";
const props = (source: string | readonly string[] | undefined = "staff", tenantId = tenant): { params: Promise<{ tenantId: string }>; searchParams: Promise<{ source?: string | string[] }> } => ({ params: Promise.resolve({ tenantId }), searchParams: Promise.resolve({ source: typeof source === "string" ? source : source ? [...source] : undefined }) });
type MetadataResult = { title?: { absolute?: string }; appleWebApp?: { title?: string }; icons?: { apple?: string | { url: string }[] } };
const metadata = (input: ReturnType<typeof props>) => {
  const fn = (page as unknown as { generateMetadata?: (p: ReturnType<typeof props>) => Promise<MetadataResult> }).generateMetadata;
  return fn ? fn(input) : Promise.resolve({} as MetadataResult);
};
beforeEach(() => {
  state.host = "club.localhost"; state.allowed = true; state.name = "Synthetic Club"; state.digest = "a".repeat(64);
  state.read.mockReset().mockImplementation(async () => ({ name: state.name, iconDigest: state.digest }));
  state.authorized.mockReset().mockImplementation(async (_tenant: string, _source: string, read: (tx: object) => Promise<unknown>) => state.allowed ? read({}) : null);
});

// Root's compiled-browser RED: install-apple-metadata-red.json records the
// inherited Aqua title and Apple icon after genuine tenant asset uploads.
it("returns the authorised club's title and current private 192px Apple icon", async () => {
  const result = await metadata(props());
  expect(result.title).toEqual({ absolute: "Synthetic Club" });
  expect(result.appleWebApp?.title).toBe("Synthetic Club");
  expect(JSON.stringify(result.icons?.apple)).toContain(`/clubs/${tenant}/icon/${state.digest}/192?source=staff`);
  expect(renderToStaticMarkup(await page.default(props()))).toContain(`/clubs/${tenant}/manifest.webmanifest?source=staff`);
});

it.each(["member", "guardian"])("keeps the explicit %s source in the private icon URL", async (source) => {
  expect(JSON.stringify((await metadata(props(source))).icons?.apple)).toContain(`?source=${source}`);
  expect(state.authorized).toHaveBeenCalledWith(tenant, source, expect.any(Function));
});

it("keeps the existing fallback icon when no custom icon exists", async () => {
  state.read.mockResolvedValueOnce({ name: "Synthetic Club", iconDigest: null });
  expect(JSON.stringify((await metadata(props())).icons?.apple)).toContain("/icons/aqua-apple-touch-icon.png");
});

it.each([["", tenant], [["staff", "guardian"], tenant], ["ops", tenant], ["staff", "not-a-uuid"]] as const)("rejects invalid selector before authorization", async (source, tenantId) => {
  await expect(metadata(props(source, tenantId))).rejects.toThrow("NOT_FOUND");
  expect(state.authorized).not.toHaveBeenCalled();
});

it("rejects a missing source before authorization", async () => {
  await expect(metadata({ ...props(), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  expect(state.authorized).not.toHaveBeenCalled();
});

it("rejects the ops host before reading tenant branding", async () => {
  state.host = "ops.localhost";
  await expect(metadata(props())).rejects.toThrow("NOT_FOUND");
  expect(state.authorized).not.toHaveBeenCalled();
});

it("fails closed for a revoked, foreign or suspended target", async () => {
  state.allowed = false;
  await expect(metadata(props("guardian"))).rejects.toThrow("NOT_FOUND");
  expect(state.read).not.toHaveBeenCalled();
});
