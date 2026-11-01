// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Phase 2 (mobile UX plan v2) — F1 + F34.
//
// F1: the platform console had no mobile navigation and no reachable
// sign-out (the only signed-in block lived in the desktop sidebar).
// The approved decision is a four-item bottom bar — exactly four,
// per DESIGN.md §2 — with sign-out moved into the mobile header so it
// never becomes a fifth nav item.
//
// F34: /ops home gains the Presets card the sidebar already links.

// The audit STORE is the only thing this unit test replaces. The
// boundary itself (lib/auth/ops-operation.ts) stays real, so a read
// whose operation row cannot be written still fails closed.
const { auditEvents, OPS_ACTOR_ID } = vi.hoisted(() => ({
  auditEvents: [] as { operation: string; outcome: string; actorId: string }[],
  OPS_ACTOR_ID: "11111111-1111-4111-8111-111111111111",
}));

// The Ops reads are audit-required: the operation row is written before
// a read result may leave the server, so the actor needs a real id and
// one of the two platform roles.
vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: OPS_ACTOR_ID,
    role: "admin",
  }),
}));
vi.mock("@/db/ops-operation-writer", () => ({
  appendOpsBoundaryEvent: async (
    operation: string,
    outcome: string,
    actorId: string,
  ) => {
    auditEvents.push({ operation, outcome, actorId });
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops",
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));
// PR3 (ops console improvements) — PlatformHome now reads the metrics
// snapshot, the needs-attention queue and recent activity; none of
// this test's cases care about that data, so it's mocked to a
// harmless empty/default shape rather than hitting a real DB.
vi.mock("@/db/platform-overview", () => ({
  getPlatformMetricsSummary: async () => ({
    activeTenants: { current: 0, previous: null },
    trialTenants: { current: 0, previous: null },
    atRiskTenants: { current: 0, previous: null },
    openOpsTasks: { current: 0, previous: null },
    asOf: null,
  }),
  getNeedsAttentionQueue: async () => [],
}));
vi.mock("@/db/platform-activity", () => ({
  listPlatformActivity: async () => ({ rows: [], total: 0 }),
}));

import PlatformLayout from "@/app/(platform)/layout";
import PlatformHome from "@/app/(platform)/ops/page";

afterEach(() => {
  cleanup();
  auditEvents.length = 0;
});

describe("PlatformLayout mobile shell (F1)", () => {
  it("renders exactly four bottom-nav destinations", async () => {
    const ui = await PlatformLayout({ children: <p>content</p> });
    render(ui);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/ops",
      "/ops/tenants",
      "/ops/features",
      "/ops/presets",
    ]);
  });

  it("puts sign-out in the mobile header (not a fifth nav item)", async () => {
    const ui = await PlatformLayout({ children: <p>content</p> });
    render(ui);

    const header = screen.getByTestId("platform-mobile-header");
    const signOut = within(header).getByRole("button", { name: "Sign out" });
    expect(signOut.closest("form")).not.toBeNull();
  });
});

describe("PlatformHome cards (F34)", () => {
  it("includes a Presets card linking to /ops/presets", async () => {
    render(await PlatformHome());

    const presets = screen.getByText("Presets").closest("a");
    expect(presets?.getAttribute("href")).toBe("/ops/presets");

    // The card is rendered from the platform reads, and every one of
    // those reads is audit-required: the operation row is written
    // before the result leaves the server.
    expect(auditEvents.map((event) => event.operation).sort()).toEqual([
      "activity.list",
      "platform.metrics.summary",
      "tenant.health.queue",
    ]);
    expect(
      auditEvents.every(
        (event) =>
          event.outcome === "success" && event.actorId === OPS_ACTOR_ID,
      ),
    ).toBe(true);
  });
});

describe("PlatformLayout desktop sidebar", () => {
  // Every route under app/(platform)/ops that isn't an auth screen
  // (login/verify) must be reachable from the desktop sidebar — the
  // gap this closes: leads/activity/whatsapp existed as routes but
  // weren't linked from anywhere in the nav. Deliberately separate
  // from the mobile bottom bar above, which stays capped at four
  // items (F1) — the two navs are allowed to diverge.
  it("links every reachable /ops surface", async () => {
    const ui = await PlatformLayout({ children: <p>content</p> });
    render(ui);

    const nav = screen.getByRole("navigation", { name: "Platform" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/ops",
      "/ops/tenants",
      "/ops/leads",
      "/ops/features",
      "/ops/presets",
      "/ops/whatsapp",
      "/ops/activity",
    ]);
  });
});
