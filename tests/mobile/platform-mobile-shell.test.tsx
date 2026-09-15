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

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    role: "operator",
  }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/ops",
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

import PlatformLayout from "@/app/(platform)/layout";
import PlatformHome from "@/app/(platform)/ops/page";

afterEach(cleanup);

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
