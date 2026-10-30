// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// UI foundation — shared shell scroll ownership.
//
// Observed defect (docs/ui-quality-contract.md, 26 October 2026): "Members
// scrolling removes sidebar contents from view. Source owner-shell.tsx
// renders an aside without sticky/viewport constraints."
//
// The contract the shell must satisfy:
//   - the desktop sidebar stays visible while the main page scrolls,
//   - an overflowing navigation scrolls on its own (branding and the
//     exit control stay reachable),
//   - the header/search stays available during long-page scrolling,
//   - one main vertical scroll owner — the document; the content column
//     must not become a second scroller (an inner scroller would break
//     the router's scroll-to-top on navigation),
//   - short screens keep every navigation item and the exit control
//     reachable.
//
// jsdom cannot lay out, so these assertions pin the class contract the
// responsive shell is made of (the same convention the existing owner
// shell test uses). The real geometry proof is a browser check at
// 1280×600 / 1280×900 / 390×844 recorded in the handoff.
//
// RED status at the time of writing (develop b22b3cd + inherited
// overlay): the aside had no sticky/viewport constraints and there was
// no independent navigation scroller, so the assertions below failed.

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

describe("owner shell — the desktop shell is viewport bound", () => {
  it("lays the shell out as a row whose sidebar keeps its own height", () => {
    renderShell();
    const shell = screen.getByTestId("owner-shell");
    expect(shell.className).toContain("lg:flex");
    // items-start keeps the sticky sidebar from being stretched to the
    // height of the content column, which is what makes it stay put.
    expect(shell.className).toContain("lg:items-start");
  });

  it("binds the sidebar to the viewport and keeps it visible while the page scrolls", () => {
    renderShell();
    const sidebar = screen.getByTestId("owner-sidebar");
    expect(sidebar.className).toContain("lg:sticky");
    expect(sidebar.className).toContain("lg:top-0");
    expect(sidebar.className).toContain("lg:h-dvh");
    expect(sidebar.className).toContain("lg:overflow-hidden");
    expect(sidebar.className).toContain("lg:flex-col");
  });
});

describe("owner shell — the navigation scrolls on its own", () => {
  it("gives the navigation region its own scroll owner", () => {
    renderShell();
    const scrollRegion = screen.getByTestId("owner-side-nav-scroll");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    // min-h-0 lets the flex child shrink below its content height, so
    // the region scrolls instead of pushing the sidebar past the viewport.
    expect(scrollRegion.className).toContain("min-h-0");
    // No scroll chaining into the page behind it.
    expect(scrollRegion.className).toContain("overscroll-contain");
  });

  it("keeps branding and the exit control outside the scrolling region", () => {
    // A role without the Settings destination (the Accountant) is the
    // case that renders the shell-level sign-out.
    renderShell([TENANT_SURFACE_NAV.owner[0]!]);
    const scrollRegion = screen.getByTestId("owner-side-nav-scroll");
    expect(within(scrollRegion).queryByText("KhelSuite")).toBeNull();
    expect(within(scrollRegion).queryByRole("button")).toBeNull();

    const sidebar = screen.getByTestId("owner-sidebar");
    expect(within(sidebar).getByText("KhelSuite")).toBeTruthy();
    expect(within(sidebar).getByRole("button")).toBeTruthy();
  });

  it("keeps every navigation item inside the scrolling region", () => {
    renderShell();
    const scrollRegion = screen.getByTestId("owner-side-nav-scroll");
    expect(within(scrollRegion).getByTestId("owner-side-nav")).toBeTruthy();
    expect(within(scrollRegion).getAllByRole("link").length).toBeGreaterThan(4);
  });
});

describe("owner shell — one vertical scroll owner for the page", () => {
  it("does not turn the content column into a second vertical scroller", () => {
    renderShell();
    const content = screen.getByTestId("owner-content");
    expect(content.className).not.toContain("overflow-y-auto");
    expect(content.className).not.toContain("overflow-auto");
  });

  it("keeps the header sticky and outside the content column", () => {
    renderShell();
    const content = screen.getByTestId("owner-content");
    expect(within(content).queryByTestId("owner-top-bar")).toBeNull();

    const topBar = screen.getByTestId("owner-top-bar");
    expect(topBar.className).toContain("sticky");
    expect(topBar.className).toContain("top-0");
  });

  it("keeps the mobile bottom nav unchanged below lg", () => {
    renderShell();
    const mobileNav = screen.getByTestId("owner-mobile-nav");
    expect(mobileNav.className).toContain("lg:hidden");
    expect(within(mobileNav).getAllByRole("link")).toHaveLength(4);
  });
});
