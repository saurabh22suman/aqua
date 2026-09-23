// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-10 — owner desktop shell. jsdom cannot lay out, so this pins the
// class contract the responsive shell is made of: the sidebar is
// hidden below lg and flex at lg, the BottomNav wrapper is lg:hidden,
// and both navs come from the same four-item TENANT_SURFACE_NAV.owner
// list (no fifth item, no "More" tab — DESIGN.md §2).

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

describe("U-10 owner shell — both navs, right breakpoints", () => {
  it("renders a sidebar hidden below lg and the unchanged bottom nav below lg", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );

    const sidebar = screen.getByTestId("owner-sidebar");
    expect(sidebar.className).toContain("hidden");
    expect(sidebar.className).toContain("lg:flex");

    const mobileNav = screen.getByTestId("owner-mobile-nav");
    expect(mobileNav.className).toContain("lg:hidden");
    expect(within(mobileNav).getByRole("navigation")).toBeTruthy();

    expect(screen.getByText("Page content")).toBeTruthy();
  });

  it("exposes exactly the four TENANT_SURFACE_NAV.owner items in both navs", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );

    const expectedHrefs = TENANT_SURFACE_NAV.owner.map((i) => i.href);

    const sidebar = screen.getByTestId("owner-sidebar");
    const sideHrefs = within(sidebar)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    // PR3-C3 — the sidebar also carries the desktop-only extras (Fees).
    expect(sideHrefs).toEqual([...expectedHrefs, "/owner/fees"]);

    const mobileNav = screen.getByTestId("owner-mobile-nav");
    const mobileHrefs = within(mobileNav)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"));
    expect(mobileHrefs).toEqual(expectedHrefs);
    expect(mobileHrefs).toHaveLength(4);

    expect(
      within(sidebar).getByRole("link", { name: "Home" }).getAttribute("aria-current"),
      "the active route must be marked in the sidebar",
    ).toBe("page");
  });

  it("carries one search box in the shared top bar (mobile + desktop)", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );

    const topBar = screen.getByTestId("owner-top-bar");
    expect(within(topBar).getByTestId("global-search-input")).toBeTruthy();
    // One instance, one header: the same sticky header serves the
    // mobile breakpoint and the desktop top bar.
    expect(screen.getAllByTestId("global-search-input")).toHaveLength(1);
  });
});

describe("owner nav Fees entry (PR3-C3)", () => {
  it("keeps the mobile bottom nav at four items and adds Fees to the desktop sidebar only", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const mobileNav = screen.getByTestId("owner-mobile-nav");
    const mobileLinks = within(mobileNav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(mobileLinks).toHaveLength(4);
    expect(mobileLinks).not.toContain("/owner/fees");

    const sidebar = screen.getByTestId("owner-side-nav");
    const sideLinks = within(sidebar)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(sideLinks).toContain("/owner/fees");
  });
});
