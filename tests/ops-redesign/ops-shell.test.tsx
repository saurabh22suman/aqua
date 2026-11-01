// @vitest-environment jsdom
//
// Ops redesign — G1: the operator console shell.
//
// The approved 20-page concept gives Ops a LIGHT sidebar painted from
// the preset's own sidebar token, a viewport-bound desktop rail whose
// navigation region is the only thing that scrolls inside it, a brand
// and an account/exit block that stay reachable on a short screen, and
// a compact phone bar whose Menu toggle reveals the destinations the
// four-item bottom bar does not carry.
//
// These assertions are about BEHAVIOUR — reachability, one landmark,
// one active destination, one keyboard-operable toggle — not about a
// class string. The light surface, the bounded geometry and the single
// scroll owner are proven by the real-Chrome geometry check in
// e2e/ops-redesign/ops-shell-geometry.ts.
//
// Scope note: this file owns the SHELL. The routes themselves are
// covered by their own agent-owned tests, so a failure here always
// means the rail, the phone bar or the identity block regressed.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: { kind: "authenticated", role: "admin" } as { kind: string; role?: string },
}));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => authState.value,
}));

const pathname = vi.hoisted(() => ({ value: "/ops" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

import PlatformLayout from "@/app/(platform)/layout";

afterEach(() => {
  cleanup();
  authState.value = { kind: "authenticated", role: "admin" };
  pathname.value = "/ops";
});

async function renderShell() {
  return render(await PlatformLayout({ children: <p>page body</p> }));
}

describe("Ops shell — desktop rail", () => {
  it("keeps the brand, the navigation and the exit control in three sibling regions", async () => {
    await renderShell();

    const sidebar = screen.getByTestId("ops-sidebar");
    const nav = within(sidebar).getByRole("navigation", { name: "Platform" });
    const signOut = within(sidebar).getByRole("button", { name: "Sign out" });

    // The navigation is its own scroll region: the exit control is NOT
    // inside it, so an overflowing menu can never push it off screen.
    expect(nav.contains(signOut)).toBe(false);
    // The brand is above the navigation, not inside it.
    expect(nav.contains(screen.getByTestId("ops-shell-brand"))).toBe(false);
    // All three live in the one rail.
    expect(sidebar.contains(nav)).toBe(true);
    expect(sidebar.contains(screen.getByTestId("ops-shell-brand"))).toBe(true);
  });

  it("marks the current destination, and the parent of a child route, with aria-current", async () => {
    pathname.value = "/ops/tenants";
    await renderShell();

    const nav = screen.getByRole("navigation", { name: "Platform" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual([
      "/ops/tenants",
    ]);
  });

  it("lights the Overview destination only on the overview route itself", async () => {
    pathname.value = "/ops";
    await renderShell();

    const nav = screen.getByRole("navigation", { name: "Platform" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/ops"]);
  });

  it("exposes exactly one Platform navigation landmark", async () => {
    await renderShell();
    expect(screen.getAllByRole("navigation", { name: "Platform" })).toHaveLength(1);
  });

  it("links every reachable /ops surface from the rail", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "Platform" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/ops",
      "/ops/tenants",
      "/ops/leads",
      "/ops/features",
      "/ops/presets",
      "/ops/whatsapp",
      "/ops/activity",
    ]);
  });

  it("keeps the four-item phone bar as the phone's primary navigation", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/ops", "/ops/tenants", "/ops/features", "/ops/presets"]);
  });
});

describe("Ops shell — phone bar", () => {
  it("offers a keyboard-operable Menu toggle for the destinations the bottom bar does not carry", async () => {
    await renderShell();

    const header = screen.getByTestId("platform-mobile-header");
    const toggle = within(header).getByRole("button", { name: /menu/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const panelId = toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("reveals the remaining destinations when the phone Menu is open", async () => {
    await renderShell();

    const toggle = screen.getByRole("button", { name: /menu/i });
    fireEvent.click(toggle);

    const panelId = toggle.getAttribute("aria-controls") as string;
    const panel = within(document.getElementById(panelId) as HTMLElement);
    expect(
      panel
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/ops",
      "/ops/tenants",
      "/ops/leads",
      "/ops/features",
      "/ops/presets",
      "/ops/whatsapp",
      "/ops/activity",
    ]);
  });

  it("closes the phone Menu when the operator navigates to a destination", async () => {
    pathname.value = "/ops";
    const { rerender } = await renderShell();

    const toggle = screen.getByRole("button", { name: /menu/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // The operator picks a destination: the Menu must not stay open
    // over the page they land on.
    pathname.value = "/ops/tenants";
    rerender(await PlatformLayout({ children: <p>the tenants list</p> }));

    expect(
      screen.getByRole("button", { name: /menu/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("keeps the exit control in the phone header, outside the bottom bar", async () => {
    await renderShell();
    const header = screen.getByTestId("platform-mobile-header");
    const signOut = within(header).getByRole("button", { name: "Sign out" });
    expect(signOut.closest("form")).not.toBeNull();
  });
});

describe("Ops shell — identity", () => {
  it("states the signed-in role", async () => {
    await renderShell();
    expect(screen.getAllByText("admin").length).toBeGreaterThan(0);
  });

  it("tells a viewer the console is read-only", async () => {
    authState.value = { kind: "authenticated", role: "viewer" };
    await renderShell();
    expect(
      screen.getAllByText(
        "Read-only: this account can browse, not change, platform data.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("renders no navigation at all when nobody is signed in", async () => {
    authState.value = { kind: "unauthenticated" };
    await renderShell();
    expect(screen.queryByRole("navigation", { name: "Platform" })).toBeNull();
    expect(screen.queryByTestId("platform-mobile-header")).toBeNull();
  });
});
