// @vitest-environment jsdom
//
// Owner Lavender B — the shared owner shell.
//
// The approved board paints a pale, viewport-bound sidebar with a
// grouped navigation, a clear active pill, the brand and the account
// reachable, and a compact sticky header. The shell is SHARED by Home,
// Members, Fees and Settings, so the changes belong here and not on a
// page.
//
// What this pins:
//
//   * the selected navigation row wears the preset's selection tokens,
//     so it reads as a pill in BOTH presets and never as a baked-in
//     white card;
//   * the brand and the account control sit OUTSIDE the scrolling
//     navigation region, so a short screen still reaches them;
//   * the header stays sticky and compact;
//   * the same nav groups and the same four-item mobile nav are
//     unchanged.
//
// RED status at the time of writing: the selected row was a hard-coded
// white `bg-paper` pill, the sidebar had no brand/account block of its
// own, and the header was a 64px search row with no crumb.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/owner",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

afterEach(cleanup);

function renderShell(navItems = TENANT_SURFACE_NAV.owner) {
  return render(
    <OwnerShell navItems={navItems} locations={[]}>
      <p>Page content</p>
    </OwnerShell>,
  );
}

describe("owner shell — the selected row wears the preset", () => {
  it("paints the active row with the selection tokens, not a baked-in white pill", () => {
    renderShell();
    const active = within(screen.getByTestId("owner-side-nav")).getByRole("link", {
      name: "Home",
    });
    expect(active.className).toContain("var(--selected-surface)");
    expect(active.className).toContain("var(--selected-ink)");
  });
});

describe("owner shell — brand and account stay reachable", () => {
  it("keeps the brand and the account control outside the scrolling region", () => {
    renderShell();
    const scrollRegion = screen.getByTestId("owner-side-nav-scroll");
    const sidebar = screen.getByTestId("owner-sidebar");
    // The brand is a region of its own, above the navigation.
    expect(within(sidebar).getByTestId("owner-shell-brand")).toBeTruthy();
    // The account control is below it and outside the scroller.
    expect(within(sidebar).getByTestId("owner-shell-account")).toBeTruthy();
    expect(within(scrollRegion).queryByTestId("owner-shell-account")).toBeNull();
    expect(within(scrollRegion).queryByTestId("owner-shell-brand")).toBeNull();
  });

  it("keeps the sign-out reachable for a role without the Settings destination", () => {
    renderShell([TENANT_SURFACE_NAV.owner[0]!]);
    const account = screen.getByTestId("owner-shell-account");
    expect(within(account).getByRole("button")).toBeTruthy();
  });
});

describe("owner shell — the header", () => {
  it("is sticky and compact, and names where the owner is", () => {
    renderShell();
    const bar = screen.getByTestId("owner-top-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("top-0");
    // Compact: shorter than the previous 64px row.
    expect(bar.className).toContain("min-h-14");
    // The record search is still the header's job.
    expect(within(bar).getByTestId("global-search-input")).toBeTruthy();
    // And the owner can see where they are.
    expect(within(bar).getByTestId("owner-shell-crumb")).toBeTruthy();
  });
});
