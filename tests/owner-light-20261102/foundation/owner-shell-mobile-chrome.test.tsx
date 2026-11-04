// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner light — FOUNDATION lane — the compact mobile chrome and the
// clearance a floating create action needs.
//
// The approved mock (outputs/owner-mock-20261102/
// khelsuite-owner-light-type-mock.html, sha256 3bd4a553…c5bca5) measures
// the phone chrome like this:
//
//   --nav-h: 64px          the bottom navigation
//   .bottom-nav a          font-size 12px, weight 400
//   .bottom-nav .is-active weight 500, --accent-strong
//   .bottom-nav svg        22×22
//   .appbar-in             padding 9px 14px  → a ~52px sticky row
//   .fab                   56×56 round, fixed, right 16px,
//                          bottom: calc(var(--nav-h) + 16px + safe-area)
//   html[data-fab="on"] .view { padding-bottom: calc(var(--nav-h) + 92px) }
//
// The last line is the rule this file exists for: a floating action must
// NOT cover the last row of a list (or the offline/PWA controls) on a
// long page or a short screen, so the content has to reserve the
// floating action's footprint ABOVE the bottom navigation.
//
// jsdom cannot lay out, so the geometry assertions pin the rendered
// class/attribute contract (the repository's established convention —
// see tests/foundation/shell-scroll.test.tsx). The real geometry proof
// stays with the coordinator's Chrome review at 390×844, 320px and
// 1280×900.

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
import { OwnerShell } from "@/components/owner-shell";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";

const GLOBALS = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

afterEach(cleanup);

function renderMobileNav() {
  return render(
    <OwnerMobileNav
      navItems={TENANT_SURFACE_NAV.owner}
      sidebarGroups={OWNER_SIDEBAR_GROUPS}
    />,
  );
}

function renderShell() {
  return render(
    <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
      <p>Page content</p>
    </OwnerShell>,
  );
}

describe("owner bottom navigation — the approved compact treatment", () => {
  it("renders the resting labels at the approved 12px / weight 400", () => {
    renderMobileNav();
    const home = screen.getByRole("link", { name: "Home" });

    // RED: the resting label is 11px / weight 500 today.
    expect(home.className).toContain("text-[12px]");
    expect(home.className).toContain("font-normal");
    expect(home.className).not.toContain("font-medium");
  });

  it("renders the active label at the approved weight 500", () => {
    renderMobileNav();
    const members = screen.getByRole("link", { name: "Members" });

    // RED: the active label asks for weight 600 today.
    expect(members.className).toContain("font-medium");
    expect(members.className).not.toContain("font-semibold");
  });

  it("renders the navigation icons at the approved 22px", () => {
    renderMobileNav();
    const home = screen.getByRole("link", { name: "Home" });
    const icon = home.querySelector("svg");

    // RED: the icon is 20×20 today (a real rendered attribute).
    expect(icon?.getAttribute("width")).toBe("22");
    expect(icon?.getAttribute("height")).toBe("22");
  });
});

describe("owner mobile header — the approved compact row", () => {
  it("keeps the sticky header at the approved 52px on a phone", () => {
    renderShell();
    const header = screen.getByTestId("owner-top-bar");

    // RED: the phone header is 56px today.
    expect(header.className).toContain("min-h-[52px]");
    expect(header.className).not.toContain("min-h-14");
  });
});

describe("owner shell — clearance for a floating create action", () => {
  it("drives the bottom clearance from one token", () => {
    renderShell();
    const shell = screen.getByTestId("owner-shell");

    // RED: the shell hardcodes 4rem today, so nothing can reserve the
    // floating action's footprint.
    expect(shell.className).toContain("pb-[var(--owner-content-bottom)]");
    expect(GLOBALS).toContain("--owner-content-bottom");
  });

  it("grows that clearance when a create action is on the page", () => {
    // RED: no rule grows the clearance for the floating action today.
    const rule = /\[data-owner-surface\][^{]*data-owner-create-action[^{]*\{([^}]*)\}/.exec(
      GLOBALS,
    );
    expect(
      rule,
      "globals.css must grow the owner content clearance when a create action is present",
    ).toBeTruthy();
    expect(rule?.[1]).toContain("--owner-content-bottom");
    expect(rule?.[1]).toContain("var(--owner-fab-size)");
  });
});

describe("owner navigation — what must NOT change", () => {
  it("keeps exactly four phone destinations", () => {
    renderMobileNav();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    // The three primary destinations are the navigation's own links; the
    // fourth column is the More disclosure.
    const primary = Array.from(nav.querySelectorAll(":scope > a"));
    // The approved SECOND option (3 November 2026): Fees is the third
    // primary destination; Calendar lives in More.
    expect(primary.map((link) => link.textContent)).toEqual([
      "Home",
      "Members",
      "Fees",
    ]);
    expect(within(nav).getByText("More")).toBeTruthy();
  });

  it("keeps every remaining destination inside More", () => {
    renderMobileNav();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    for (const destination of [
      // Calendar moved into More when Fees became the third primary.
      "Calendar",
      "Enquiries",
      "Announcements",
      "Staff",
      "Programs & batches",
      "Sessions",
      "Reports",
      "Settings",
    ]) {
      expect(labels, `More must still offer ${destination}`).toContain(destination);
    }
  });

  it("marks the current destination for assistive technology", () => {
    renderMobileNav();
    const members = screen.getByRole("link", { name: "Members" });
    expect(members.getAttribute("aria-current")).toBe("page");
  });

  it("keeps the 64px navigation height and hides the phone navigation on desktop", () => {
    renderMobileNav();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.className).toContain("min-h-16");

    // The phone navigation is a phone surface: the desktop shell keeps
    // the sidebar and hides it at lg.
    renderShell();
    const wrapper = screen.getByTestId("owner-mobile-nav");
    expect(wrapper.className).toContain("lg:hidden");
  });
});
