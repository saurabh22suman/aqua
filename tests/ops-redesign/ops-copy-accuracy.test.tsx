// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — two copy-accuracy fixes.
//
// 1. The Overview's EMPTY needs-attention queue.
//
//    The queue is LIVE: it is computed from tenant health, not from the
//    nightly metrics snapshot. The empty state said "Every tenant is
//    healthy, or the metrics snapshot hasn't run yet" — which offered a
//    MISSING METRICS SNAPSHOT as an explanation for an empty queue, and
//    the two are independent data sources. An operator reading it could
//    conclude that a console with no snapshot also has no issues.
//
//    The copy must not offer the snapshot as the reason, and must say
//    where the queue's answer actually comes from.
//
// 2. The Configuration page's lede.
//
//    The RESOLVED VALUES are read-only, but the page also carries the
//    change-request decisions, which DO mutate. The lede called the
//    whole page read-only, which is not true of it. It must describe
//    the values as read-only and point at the separate decision
//    controls.
//
// The guards (admin / viewer) and the data boundaries are untouched by
// this change; only the wording moves.

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/ops/tenants/t1/configuration",
}));

vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    activeTenants: { current: 1, previous: null },
    trialTenants: { current: 2, previous: null },
    atRiskTenants: { current: 0, previous: null },
    openOpsTasks: { current: 1, previous: null },
    asOf: new Date("2026-10-28T10:05:00.000Z"),
  }),
  // The queue is EMPTY: that is the state whose copy is wrong.
  getNeedsAttentionQueue: async () => [],
}));

vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [], total: 0 }),
}));

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@/db/ops-configuration-view", () => ({
  getEffectiveConfiguration: async () => ({
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
    config: [],
    locationConfig: [],
    roles: [{ key: "coach", name: "Coach", homePath: "/coach", permissions: [] }],
  }),
}));
vi.mock("@/db/config-requests", () => ({
  listConfigChangeRequests: async () => [],
}));
vi.mock("@/db/platform-tenants", () => ({
  listAllTenantsForSelector: async () => [],
}));
vi.mock("@/lib/nav", () => ({ navForRole: () => [] }));

import PlatformHome from "@/app/(platform)/ops/page";
import EffectiveConfigurationPage from "@/app/(platform)/ops/tenants/[tenantId]/configuration/page";

afterEach(cleanup);

describe("Overview — the empty queue's copy", () => {
  // The Overview has more than one empty state (the queue AND the
  // recent activity), so the queue's is scoped to its own section.
  function queueEmptyState(): HTMLElement {
    const heading = screen.getByRole("heading", { name: "Needs attention" });
    const section = heading.closest("section");
    if (!section) throw new Error("the needs-attention section was not rendered");
    return within(section as HTMLElement).getByTestId("ops-empty-state");
  }

  it("does not offer the missing metrics snapshot as the reason the queue is empty", async () => {
    render(await PlatformHome());

    const copy = queueEmptyState().textContent ?? "";
    expect(copy).not.toMatch(/metrics snapshot/i);
  });

  it("says where the queue's answer comes from", async () => {
    render(await PlatformHome());

    expect(queueEmptyState().textContent ?? "").toMatch(/live|health/i);
  });
});

describe("Configuration — the lede's accuracy", () => {
  it("describes the resolved values as read-only", async () => {
    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText(/read-only/i)).toBeDefined();
  });

  it("points at the separate change-request decisions instead of calling the whole page read-only", async () => {
    render(
      await EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
        searchParams: Promise.resolve({}),
      }),
    );

    // The LEDE, not the "Change requests" section heading below it.
    const lede = screen.getByText(/resolved values are read-only/i);
    expect(lede.textContent ?? "").toMatch(/change request/i);
  });
});
