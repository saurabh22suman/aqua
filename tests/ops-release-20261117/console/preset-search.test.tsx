import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-auth", () => ({ platformAuthStatusAction: async () => ({ kind: "authenticated", role: "admin" }) }));
vi.mock("@/lib/auth/ops-operation", () => ({ runOpsGlobalRead: async (_op: string, read: () => Promise<unknown>) => read() }));
vi.mock("@/db/platform-presets", () => ({ getActivePreset: async () => ({ key: "swim", name: "Swim", description: "" }) }));
vi.mock("@/db/preset-engine", () => ({ previewPreset: async () => ({ preview: { counts: {} } }), presetOfferedForKind: () => true }));
vi.mock("@/db/platform-tenants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/platform-tenants")>();
  return {
    listTenants: (input: unknown) => {
      actual.listTenantsInput.parse(input);
      return list(input);
    },
    listLocationsForOps: async () => [],
  };
});
vi.mock("@/app/(platform)/ops/presets/[key]/preset-detail-form", () => ({ PresetDetailForm: () => null }));
import PresetDetailPage from "@/app/(platform)/ops/presets/[key]/page";
it("uses the searched second page instead of silently fixing the picker to the first 200", async () => {
  list.mockResolvedValue({ rows: [], total: 250 });
  const props = { params: Promise.resolve({ key: "swim" }), searchParams: Promise.resolve({ search: "club", page: "2" }) };
  await PresetDetailPage(props);
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "club", offset: 200, limit: 200 }));
});
it("ignores a repeated search query rather than throwing", async () => {
  list.mockClear();
  list.mockResolvedValue({ rows: [], total: 0 });
  const props = { params: Promise.resolve({ key: "swim" }), searchParams: Promise.resolve({ search: ["a", "b"] }) };
  await expect(PresetDetailPage(props as unknown as Parameters<typeof PresetDetailPage>[0])).resolves.toBeDefined();
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: undefined, offset: 0 }));
});
it("bounds a direct 121-character search, retains page semantics, and limits the input", async () => {
  list.mockClear();
  list.mockResolvedValue({ rows: [], total: 250 });
  const query = "a".repeat(121);
  const page = await PresetDetailPage({ params: Promise.resolve({ key: "swim" }), searchParams: Promise.resolve({ search: query, page: "2" }) });
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: "a".repeat(120), offset: 200 }));
  const html = renderToStaticMarkup(page);
  expect(html).toMatch(/name="search"[^>]*maxLength="120"|maxLength="120"[^>]*name="search"/i);
  expect(html).toContain(`search=${"a".repeat(120)}`);
});
it("continues to ignore repeated long search query values", async () => {
  list.mockClear();
  list.mockResolvedValue({ rows: [], total: 0 });
  const props = { params: Promise.resolve({ key: "swim" }), searchParams: Promise.resolve({ search: ["a".repeat(121), "b".repeat(121)] }) };
  await expect(PresetDetailPage(props as unknown as Parameters<typeof PresetDetailPage>[0])).resolves.toBeDefined();
  expect(list).toHaveBeenCalledWith(expect.objectContaining({ search: undefined, offset: 0 }));
});
