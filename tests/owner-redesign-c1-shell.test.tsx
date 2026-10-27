// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · System lane — the owner shell.
//
// The shell is the shared frame for every owner page, so its controls and
// its navigation carry the approved contract too:
//
//   * the record search is a standard control (48px, 10px radius, 16px
//     text) with a useful flexible width;
//   * the facility switcher is a standard picker (48px, 10px radius,
//     lightly tinted);
//   * the scroll ownership stays exactly as the foundation recorded it —
//     one document scroller, a viewport-bound sticky sidebar and one
//     navigation scroller inside it;
//   * the mobile bottom nav stays at four items and the desktop sidebar
//     carries the grouped destinations, now including the booking desk.
//
// RED status at the time of writing: the search was a 44px
// `rounded-ctl` field, the switcher was a 44px bordered box around a
// bare select, and the booking desk had no navigation entry at all.

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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerShell } from "@/components/owner-shell";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";

afterEach(cleanup);

const TWO_LOCATIONS = [
  { id: "loc-1", name: "Worli Main" },
  { id: "loc-2", name: "Andheri" },
];

describe("the owner shell — the shared controls carry the approved contract", () => {
  it("gives the record search the standard control metrics", () => {
    render(<GlobalSearch />);
    const input = screen.getByTestId("global-search-input");
    expect(input.className).toContain("min-h-12");
    expect(input.className).toContain("rounded-ctl");
    expect(input.className).toContain("text-[16px]");
  });

  it("gives the facility switcher the standard picker metrics", () => {
    render(<FacilitySwitcher locations={TWO_LOCATIONS} />);
    const select = screen.getByTestId("facility-switcher");
    expect(select.className).toContain("min-h-12");
    expect(select.className).toContain("rounded-ctl");
    expect(select.className).toContain("text-[16px]");
  });

  it("keeps the switcher a labelled native select (the platform picker on a phone)", () => {
    render(<FacilitySwitcher locations={TWO_LOCATIONS} />);
    const select = screen.getByTestId("facility-switcher");
    expect(select.tagName).toBe("SELECT");
    expect(select.getAttribute("aria-label") ?? select.id).toBeTruthy();
    expect(within(select).getByRole("option", { name: "All facilities" })).toBeTruthy();
  });

  it("keeps a dropdown affordance on the picker", () => {
    // The independent review found that the switcher applies
    // `appearance-none` — removing the browser's own arrow — while the
    // wrapper offers only a location pin, so the row reads as a location
    // display and not as a choice. The shared Select supplies a
    // decorative chevron for exactly this reason.
    render(<FacilitySwitcher locations={TWO_LOCATIONS} />);
    const chevron = screen.getByTestId("facility-switcher-chevron");
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("the owner shell — scroll ownership is unchanged", () => {
  it("keeps the sidebar viewport bound and the navigation the only inner scroller", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const sidebar = screen.getByTestId("owner-sidebar");
    expect(sidebar.className).toContain("lg:sticky");
    expect(sidebar.className).toContain("lg:h-dvh");
    expect(sidebar.className).toContain("lg:overflow-hidden");

    const navScroll = screen.getByTestId("owner-side-nav-scroll");
    expect(navScroll.className).toContain("overflow-y-auto");
    expect(navScroll.className).toContain("min-h-0");
    expect(navScroll.className).toContain("overscroll-contain");

    const content = screen.getByTestId("owner-content");
    expect(content.className).not.toContain("overflow-y-auto");
  });

  it("keeps the header sticky and the bottom nav at four items", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    expect(screen.getByTestId("owner-top-bar").className).toContain("sticky");
    const mobileNav = screen.getByTestId("owner-mobile-nav");
    expect(within(mobileNav).getAllByRole("link")).toHaveLength(4);
  });
});

describe("the owner shell — the navigation carries the grouped destinations", () => {
  it("renders every sidebar group in order", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const sidebar = screen.getByTestId("owner-side-nav");
    const hrefs = within(sidebar)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      OWNER_SIDEBAR_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    );
  });

  it("marks the current route in the sidebar", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Page content</p>
      </OwnerShell>,
    );
    const sidebar = screen.getByTestId("owner-side-nav");
    expect(
      within(sidebar).getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
