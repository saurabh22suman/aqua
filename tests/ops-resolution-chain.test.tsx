// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR5 (ops console improvements) — the effective-configuration screen
// gains a tenant selector, a "why this value" full waterfall, and a
// configuration audit log scoped to the selected tenant+key.

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/nav", () => ({
  navForRole: () => [],
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222";
const CONFIG_KEY = "messaging.whatsapp_provider";

const view = {
  tenant: {
    id: TENANT_ID,
    name: "Aqua Club Salt Lake",
    slug: "aqua-saltlake",
    status: "active",
    planName: "Standard",
    timezone: "Asia/Kolkata",
    locations: [],
    featureKeys: [],
  },
  config: [
    {
      key: CONFIG_KEY,
      value: "cloud_api",
      visibility: "ops_only",
      risk: "sensitive",
      description: "Which WhatsApp provider this tenant sends through.",
      source: { scopeType: "tenant", scopeId: TENANT_ID, setBy: "u1", setAt: new Date() },
    },
  ],
  locationConfig: [],
  roles: [{ key: "coach", name: "Coach", homePath: "/coach", permissions: [] }],
};

vi.mock("@/db/ops-configuration-view", () => ({
  getEffectiveConfiguration: async () => view,
}));
vi.mock("@/db/config-requests", () => ({
  listConfigChangeRequests: async () => [],
}));
vi.mock("@/db/platform-tenants", () => ({
  listAllTenantsForSelector: async () => [
    { id: TENANT_ID, name: "Aqua Club Salt Lake", slug: "aqua-saltlake" },
    { id: OTHER_TENANT_ID, name: "Blue Wave Academy", slug: "bluewave" },
  ],
}));

const resolveConfigChainMock = vi.fn();
vi.mock("@/db/config", () => ({
  resolveConfigChain: (...args: unknown[]) => resolveConfigChainMock(...args),
}));

const auditLogMock = vi.fn();
vi.mock("@/db/tenant-config-audit", () => ({
  getTenantConfigAuditLog: (...args: unknown[]) => auditLogMock(...args),
}));

import EffectiveConfigurationPage from "@/app/(platform)/ops/tenants/[tenantId]/configuration/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Effective configuration — tenant selector", () => {
  it("renders every tenant as an option, with the current one selected", async () => {
    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    const select = screen.getByText("Tenant").closest("label")?.querySelector("select");
    if (!select) throw new Error("tenant select not found");
    expect(within(select).getByText(/Aqua Club Salt Lake/)).toBeDefined();
    expect(within(select).getByText(/Blue Wave Academy/)).toBeDefined();
    expect((select as HTMLSelectElement).value).toBe(TENANT_ID);
  });
});

describe("Effective configuration — why this value", () => {
  it("does not render the resolution chain until a key is selected", async () => {
    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByText("Why this value?")).not.toBeNull(); // the link
    expect(screen.queryByText("Configuration audit log")).toBeNull(); // the panel
  });

  it("renders the full waterfall and the scoped audit log when ?key= matches a real key", async () => {
    resolveConfigChainMock.mockResolvedValue([
      { scopeType: "platform", scopeId: null, value: "twilio", hasOverride: false, setBy: null, setAt: null, isWinner: false },
      { scopeType: "plan", scopeId: "p1", value: "twilio", hasOverride: true, setBy: "u1", setAt: new Date(), isWinner: false },
      { scopeType: "preset", scopeId: "swimming@1", value: "cloud_api", hasOverride: true, setBy: "u1", setAt: new Date(), isWinner: false },
      { scopeType: "tenant", scopeId: TENANT_ID, value: "cloud_api", hasOverride: true, setBy: "u1", setAt: new Date(), isWinner: true },
      { scopeType: "location", scopeId: null, value: undefined, hasOverride: false, setBy: null, setAt: null, isWinner: false },
      { scopeType: "activity", scopeId: null, value: undefined, hasOverride: false, setBy: null, setAt: null, isWinner: false },
    ]);
    auditLogMock.mockResolvedValue([
      {
        id: "ops-1",
        action: "config.request.resolve",
        actorLabel: "Ops",
        createdAt: new Date("2026-09-14T20:00:00.000Z"),
        before: null,
        after: {},
      },
    ]);

    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({ key: CONFIG_KEY }),
      }),
    );

    expect(resolveConfigChainMock).toHaveBeenCalledWith(TENANT_ID, CONFIG_KEY);
    expect(auditLogMock).toHaveBeenCalledWith(TENANT_ID, CONFIG_KEY);

    expect(screen.getByText("Why this value?", { selector: "p" })).toBeDefined();
    expect(screen.getByText("Platform default")).toBeDefined();
    // Both twilio occurrences (platform + plan) render in the chain, and
    // cloud_api renders 3x: the main resolved-value row plus the chain's
    // preset and tenant entries — every level shows, not just the winner.
    expect(screen.getAllByText("twilio").length).toBe(2);
    expect(screen.getAllByText("cloud_api").length).toBe(3);
    expect(screen.getByText("Applied")).toBeDefined();
    expect(screen.getAllByText("Not set").length).toBe(2); // location, activity

    expect(screen.getByText("Configuration audit log")).toBeDefined();
    expect(screen.getByText(/Ops/)).toBeDefined();
  });

  it("ignores an unknown ?key= rather than crashing", async () => {
    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({ key: "not.a.real.key" }),
      }),
    );

    expect(resolveConfigChainMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Configuration audit log")).toBeNull();
  });
});
