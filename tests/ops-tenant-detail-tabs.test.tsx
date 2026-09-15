// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR4 (ops console improvements) — every existing tenant-detail panel
// grouped into tabs (Overview / Configuration / Entitlements /
// Locations / Messaging / Audit), each a real route sharing one
// layout (name + status header + tab bar).

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("@/lib/params", () => ({
  requireUuidParam: () => undefined,
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/db/platform-tenants", () => ({
  getTenantHeader: async () => ({
    id: TENANT_ID,
    name: "Aqua Worli",
    slug: "aqua-worli",
    status: "active",
  }),
}));
vi.mock("@/db/platform-tenant-messaging", () => ({
  getTenantMessagingSummary: async () => ({
    provider: "mock",
    lastSentAt: new Date("2026-09-15T10:00:00.000Z"),
    sentCount7d: 12,
    failedCount7d: 1,
  }),
}));

afterEach(() => {
  cleanup();
  vi.doUnmock("next/navigation");
});

describe("Tenant detail — layout and tab bar", () => {
  it("renders all six tabs with the correct hrefs", async () => {
    vi.doMock("next/navigation", () => ({
      usePathname: () => `/ops/tenants/${TENANT_ID}`,
      notFound: () => {
        throw new Error("unexpected notFound");
      },
      redirect: (path: string) => {
        throw new Error(`unexpected redirect: ${path}`);
      },
    }));
    vi.resetModules();
    const { default: FreshLayout } = await import(
      "@/app/(platform)/ops/tenants/[tenantId]/layout"
    );

    render(
      await FreshLayout({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        children: <p>tab content</p>,
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Tenant" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `/ops/tenants/${TENANT_ID}`,
      `/ops/tenants/${TENANT_ID}/configuration`,
      `/ops/tenants/${TENANT_ID}/entitlements`,
      `/ops/tenants/${TENANT_ID}/locations`,
      `/ops/tenants/${TENANT_ID}/messaging`,
      `/ops/tenants/${TENANT_ID}/audit`,
    ]);
  });

  it("marks the current route's tab active via aria-current", async () => {
    vi.doMock("next/navigation", () => ({
      usePathname: () => `/ops/tenants/${TENANT_ID}/locations`,
      notFound: () => {
        throw new Error("unexpected notFound");
      },
      redirect: (path: string) => {
        throw new Error(`unexpected redirect: ${path}`);
      },
    }));
    vi.resetModules();
    const { default: FreshLayout } = await import(
      "@/app/(platform)/ops/tenants/[tenantId]/layout"
    );

    render(
      await FreshLayout({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        children: <p>tab content</p>,
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Tenant" });
    const active = within(nav).getByText("Locations").closest("a");
    expect(active?.getAttribute("aria-current")).toBe("page");
    const inactive = within(nav).getByText("Overview").closest("a");
    expect(inactive?.getAttribute("aria-current")).toBeNull();
  });

  it("renders the tenant name and status in the header", async () => {
    vi.doMock("next/navigation", () => ({
      usePathname: () => `/ops/tenants/${TENANT_ID}`,
      notFound: () => {
        throw new Error("unexpected notFound");
      },
      redirect: (path: string) => {
        throw new Error(`unexpected redirect: ${path}`);
      },
    }));
    vi.resetModules();
    const { default: FreshLayout } = await import(
      "@/app/(platform)/ops/tenants/[tenantId]/layout"
    );

    render(
      await FreshLayout({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        children: <p>tab content</p>,
      }),
    );

    expect(screen.getByText("Aqua Worli")).toBeDefined();
    expect(screen.getByText("Active")).toBeDefined();
  });
});

describe("Tenant detail — Messaging tab", () => {
  it("renders provider, last-sent time, and 7-day counts", async () => {
    vi.doMock("next/navigation", () => ({
      redirect: (path: string) => {
        throw new Error(`unexpected redirect: ${path}`);
      },
      notFound: () => {
        throw new Error("unexpected notFound");
      },
    }));
    vi.resetModules();
    const { default: FreshMessagingPage } = await import(
      "@/app/(platform)/ops/tenants/[tenantId]/messaging/page"
    );

    render(
      await FreshMessagingPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
      }),
    );

    expect(screen.getByText("Non-production mock")).toBeDefined();
    expect(screen.getByText("12")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("shows 'not connected' when no message has ever been sent", async () => {
    vi.doMock("next/navigation", () => ({
      redirect: (path: string) => {
        throw new Error(`unexpected redirect: ${path}`);
      },
      notFound: () => {
        throw new Error("unexpected notFound");
      },
    }));
    vi.doMock("@/db/platform-tenant-messaging", () => ({
      getTenantMessagingSummary: async () => ({
        provider: null,
        lastSentAt: null,
        sentCount7d: 0,
        failedCount7d: 0,
      }),
    }));
    vi.resetModules();
    const { default: FreshMessagingPage } = await import(
      "@/app/(platform)/ops/tenants/[tenantId]/messaging/page"
    );

    render(
      await FreshMessagingPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
      }),
    );

    expect(screen.getByText(/Not connected/)).toBeDefined();
  });
});
