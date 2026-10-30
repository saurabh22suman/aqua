// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the Overview's markup.
//
// A POPULATED Overview nests a paragraph inside a paragraph: the KPI
// tile's description element wraps the delta line, which is itself a
// paragraph. That is invalid HTML, and it produces a hydration
// mismatch in the browser — the server sends one tree and the client
// rebuilds another.
//
// It only shows on the POPULATED Overview (the one with a snapshot and
// a delta), which is why the empty-state capture looked clean.
//
// The regression is a MARKUP rule, asserted on the rendered DOM: no
// paragraph may contain another paragraph.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

// The Ops pages resolve their reads through the approved operation
// boundary. These suites assert the page contract, not the audit path, so
// the boundary delegates to the read it is given. Fixture-only.
vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsRead: async (
    _operation: string,
    _tenantId: string,
    read: () => Promise<unknown>,
  ) => read(),
  runOpsGlobalRead: async (
    _operation: string,
    read: () => Promise<unknown>,
  ) => read(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    activeTenants: { current: 128, previous: 120 },
    trialTenants: { current: 17, previous: 20 },
    atRiskTenants: { current: 6, previous: 6 },
    openOpsTasks: { current: 11, previous: 8 },
    asOf: new Date("2026-09-15T04:00:00.000Z"),
  }),
  getNeedsAttentionQueue: async () => [],
}));

vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [], total: 0 }),
}));

import PlatformHome from "@/app/(platform)/ops/page";

afterEach(cleanup);

describe("Overview — the markup", () => {
  it("never nests a paragraph inside a paragraph", async () => {
    const { container } = render(await PlatformHome());

    const nested = Array.from(container.querySelectorAll("p")).filter((paragraph) =>
      paragraph.querySelector("p"),
    );
    expect(
      nested.map((paragraph) => paragraph.textContent?.slice(0, 60)),
      "a paragraph contains another paragraph — invalid HTML and a hydration mismatch",
    ).toEqual([]);
  });

  it("still shows the delta line the populated Overview is about", async () => {
    render(await PlatformHome());
    const { screen } = await import("@testing-library/react");
    expect(screen.getByText(/\+8 from last month/)).toBeDefined();
  });
});
