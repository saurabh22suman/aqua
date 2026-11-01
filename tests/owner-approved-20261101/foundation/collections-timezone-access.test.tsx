// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permissions: new Set<string>(["reports.financial"]), features: new Set(["reports", "billing"]), locations: vi.fn(async () => []), access: vi.fn(async () => ({ unrestricted: true })), timezone: vi.fn(async () => "Asia/Kolkata") }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("denied"); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/context", () => ({ requireDefaultCtx: async () => ({ tenantId: "tenant", userId: "user", permissions: state.permissions, features: state.features }) }));
vi.mock("@/lib/auth/surface-guard", async original => ({ ...await original<typeof import("@/lib/auth/surface-guard")>(), requireOwner: async () => ({ tenantId: "tenant", userId: "user", permissions: state.permissions, features: state.features }) }));
vi.mock("@/db/tenant", () => ({ withTenant: async (_tenant: unknown, fn: (tx: object) => unknown) => fn({}) }));
vi.mock("@/lib/services/people", () => ({ listLocations: state.locations }));
vi.mock("@/lib/services/location-access", () => ({ resolveLocationAccess: state.access }));
vi.mock("@/lib/services/tenant-timezone", () => ({ tenantTimezoneInTx: state.timezone }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/components/reports/collections-report", () => ({ CollectionsReport: () => null }));
import CollectionsPage from "@/app/(owner)/owner/reports/collections/page";

it("allows financial-only daily close through the real timezone authorization boundary", async () => {
  state.permissions.clear(); state.permissions.add("reports.financial");
  await expect(CollectionsPage({})).resolves.toBeTruthy();
  expect(state.timezone).toHaveBeenCalledWith(expect.anything(), "tenant");
});

it("denies missing financial access before any location or timezone reads", async () => {
  vi.clearAllMocks(); state.permissions.clear();
  await expect(CollectionsPage({})).rejects.toThrow("denied");
  expect(state.locations).not.toHaveBeenCalled();
  expect(state.access).not.toHaveBeenCalled();
  expect(state.timezone).not.toHaveBeenCalled();
});
