// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR4 (ops console improvements) — plan/preset/health/trial filters
// and pagination on the tenants list. The real filtering logic lives
// in db/platform-tenants.ts (covered separately against a real,
// disposable Postgres); this covers the page's own rendering:
// dropdown options, the pager, and that "Clear" / filter state
// reflects the URL.

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
}));

const listTenantsMock = vi.fn();
vi.mock("@/db/platform-tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
  listAllPlansForFilter: async () => [
    { id: "plan-growth", name: "Growth" },
    { id: "plan-standard", name: "Standard" },
  ],
}));
vi.mock("@/db/platform-presets", () => ({
  listPresets: async () => [
    { key: "swimming", version: 1, name: "Swimming (default)", description: "", status: "active" },
    { key: "swimming", version: 2, name: "Swimming (default)", description: "", status: "active" },
    { key: "badminton", version: 1, name: "Badminton", description: "", status: "active" },
  ],
}));

import PlatformTenantsPage from "@/app/(platform)/ops/tenants/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function tenantRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "t1",
    name: "Aqua Worli",
    slug: "demo-academy",
    status: "active",
    memberCount: 40,
    locationCount: 2,
    planName: "Growth",
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    trialExpiresAt: null,
    health: "healthy",
    healthReasons: [],
    ...overrides,
  };
}

describe("Tenants list filters", () => {
  it("renders Plan options deduplicated and Preset options deduplicated by key", async () => {
    listTenantsMock.mockResolvedValue({ total: 1, rows: [tenantRow()] });

    const { container } = render(
      await PlatformTenantsPage({ searchParams: Promise.resolve({}) }),
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("filter form not found");

    const planSelect = within(form).getByText("Plan").closest("label")?.querySelector("select");
    if (!planSelect) throw new Error("plan select not found");
    expect(within(planSelect).getByText("Growth")).toBeDefined();
    expect(within(planSelect).getByText("Standard")).toBeDefined();

    const presetSelect = within(form).getByText("Preset").closest("label")?.querySelector("select");
    if (!presetSelect) throw new Error("preset select not found");
    // "Swimming (default)" appears once, not twice, despite two versions.
    expect(within(presetSelect).getAllByText("Swimming (default)")).toHaveLength(1);
    expect(within(presetSelect).getByText("Badminton")).toBeDefined();
  });

  it("passes health and trial filters through to listTenants", async () => {
    listTenantsMock.mockResolvedValue({ total: 0, rows: [] });

    await PlatformTenantsPage({
      searchParams: Promise.resolve({ health: "at_risk", trial: "expiring_soon" }),
    });

    expect(listTenantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ health: "at_risk", trial: "expiring_soon" }),
    );
  });

  it("ignores an invalid health/trial query value rather than passing it through", async () => {
    listTenantsMock.mockResolvedValue({ total: 0, rows: [] });

    await PlatformTenantsPage({
      searchParams: Promise.resolve({ health: "not-a-real-value" }),
    });

    expect(listTenantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ health: undefined }),
    );
  });
});

describe("Tenants list pagination", () => {
  it("shows the correct range and hides the pager when everything fits on one page", async () => {
    listTenantsMock.mockResolvedValue({
      total: 3,
      rows: [tenantRow({ id: "a" }), tenantRow({ id: "b" }), tenantRow({ id: "c" })],
    });

    render(await PlatformTenantsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/Showing 1–3 of 3 tenants/)).toBeDefined();
    expect(screen.queryByText(/Page \d+ of \d+/)).toBeNull();
  });

  it("shows Previous/Next and computes the correct range on page 2 of many", async () => {
    listTenantsMock.mockResolvedValue({
      total: 45,
      rows: Array.from({ length: 20 }, (_, i) => tenantRow({ id: `t${i}` })),
    });

    render(await PlatformTenantsPage({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(listTenantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 20 }),
    );
    expect(screen.getByText(/Showing 21–40 of 45 tenants/)).toBeDefined();
    expect(screen.getByText("Page 2 of 3")).toBeDefined();
    const prev = screen.getByText("Previous").closest("a");
    const next = screen.getByText("Next").closest("a");
    // Page 1 is the canonical URL with no ?page param.
    expect(prev?.getAttribute("href")).toBe("/ops/tenants");
    expect(next?.getAttribute("href")).toBe("/ops/tenants?page=3");
  });

  it("preserves active filters across page links", async () => {
    listTenantsMock.mockResolvedValue({
      total: 45,
      rows: Array.from({ length: 20 }, (_, i) => tenantRow({ id: `t${i}` })),
    });

    render(
      await PlatformTenantsPage({
        searchParams: Promise.resolve({ status: "trial", health: "attention", page: "2" }),
      }),
    );

    const next = screen.getByText("Next").closest("a");
    const href = next?.getAttribute("href") ?? "";
    expect(href).toContain("status=trial");
    expect(href).toContain("health=attention");
    expect(href).toContain("page=3");
  });

  it("disables Previous on page 1 and Next on the last page", async () => {
    listTenantsMock.mockResolvedValue({
      total: 45,
      rows: Array.from({ length: 20 }, (_, i) => tenantRow({ id: `t${i}` })),
    });

    render(await PlatformTenantsPage({ searchParams: Promise.resolve({ page: "1" }) }));
    expect(screen.getByText("Previous").closest("a")).toBeNull();
    expect(screen.getByText("Next").closest("a")).not.toBeNull();

    cleanup();
    render(await PlatformTenantsPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(screen.getByText("Next").closest("a")).toBeNull();
    expect(screen.getByText("Previous").closest("a")).not.toBeNull();
  });
});
