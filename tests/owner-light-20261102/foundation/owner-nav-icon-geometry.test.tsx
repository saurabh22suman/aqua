// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the Owner navigation's ACTUAL icon geometry.
//
// Human correction (2 November 2026, ICON-ADDENDUM.md): the baseline
// screenshot's icons do not match the approved mock. This file records
// the REAL geometry the Owner navigation renders today, before the
// replacement, and then pins the approved geometry.
//
// The current state (the RED this file was written for):
//
//   - the phone Home item draws the Lucide "layout-dashboard" GRID, not
//     the mock's house;
//   - the phone "More" item draws three TEXT BULLETS (•••), not the
//     mock's circular dots;
//   - the desktop sidebar draws the same Lucide grid for Home;
//   - the header record search draws the Lucide magnifier, not the
//     mock's search outline.
//
// A missing import is not a RED: the assertions below read the RENDERED
// svg of the real navigation.

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
  usePathname: () => "/owner/members",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { OwnerSideNav } from "@/components/owner-side-nav";
import { OwnerShell } from "@/components/owner-shell";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";

const MOCK_HOME_PATH =
  "M3.5 10.7 12 3.9l8.5 6.8V20a1 1 0 0 1-1 1h-4.6v-5.6h-5.8V21H4.5a1 1 0 0 1-1-1z";
const MOCK_SEARCH_PATH = "m15.5 15.5 4 4";

afterEach(cleanup);

function renderMobileNav() {
  return render(
    <OwnerMobileNav
      navItems={TENANT_SURFACE_NAV.owner}
      sidebarGroups={OWNER_SIDEBAR_GROUPS}
    />,
  );
}

describe("Owner navigation — the approved icon geometry", () => {
  it("draws the mock's house for the phone Home item", () => {
    renderMobileNav();
    const home = screen.getByRole("link", { name: "Home" });
    const svg = home.querySelector("svg");

    // RED (today): the Lucide layout-dashboard GRID is drawn here.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(MOCK_HOME_PATH);
  });

  it("draws the mock's circular dots for the phone More item", () => {
    renderMobileNav();
    const more = screen.getByText("More").closest("summary");
    const svg = more?.querySelector("svg");

    // RED (today): the More trigger draws the text "•••".
    expect(svg).toBeTruthy();
    expect(svg?.querySelectorAll("circle")).toHaveLength(3);
    expect(svg?.querySelectorAll("circle")[0]?.getAttribute("cy")).toBe("12");
  });

  it("draws the mock's house in the desktop sidebar too", () => {
    render(<OwnerSideNav groups={OWNER_SIDEBAR_GROUPS} />);
    const sideNav = screen.getByTestId("owner-side-nav");
    const home = within(sideNav).getByRole("link", { name: "Home" });
    const svg = home.querySelector("svg");

    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(MOCK_HOME_PATH);
  });

  it("draws the mock's search outline in the owner's search fields", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const header = screen.getByTestId("owner-top-bar");
    const input = within(header).getByTestId("global-search-input");
    const svg = input.parentElement?.querySelector("svg");

    // RED (before the correction): the field drew the Lucide magnifier.
    expect(svg?.querySelector("circle")?.getAttribute("r")).toBe("6");
    expect(svg?.querySelector("path")?.getAttribute("d")).toBe(MOCK_SEARCH_PATH);
  });
});
