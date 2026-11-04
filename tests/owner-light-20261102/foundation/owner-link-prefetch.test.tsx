// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — Owner navigation reads on NAVIGATION, not in the background.
//
// Human-authorised UI change (3 November 2026): the owner's pages are
// read when the owner navigates to them, not opportunistically prefetched
// in the background. The root's browser evidence: a normal production SPA
// profile → Edit → Cancel stalls on a prefetched RSC, while aborting every
// automatic prefetch request makes all 21 journeys pass. Idle direct RSC
// requests complete in 20–260 ms, so no server-await or DB defect is
// proven; this is a per-Link UI setting, not a framework patch.
//
// The mechanism is a small shared facade over next/link
// (components/owner-ui/owner-link.tsx) that forces `prefetch={false}` for
// the owner destinations and forwards everything else unchanged.
//
// RED PROVENANCE: written BEFORE the facade exists. This file spies on
// next/link and inspects the RENDERED owner components, so every
// assertion below fails on the actual requested prefetch behaviour
// (`undefined` — the automatic default), not on a missing module.

const linkSpy = vi.hoisted(() => ({
  calls: [] as Array<{ href: unknown; prefetch: unknown }>,
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      prefetch?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, prefetch, children, ...rest } = props;
      linkSpy.calls.push({ href, prefetch });
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: vi.fn(async () => []),
}));

import { OwnerShell } from "@/components/owner-shell";
import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";
import { StaffBoard } from "@/components/staff-board";
import { OWNER_SIDEBAR_GROUPS, TENANT_SURFACE_NAV } from "@/lib/nav";
import type { StaffRow } from "@/lib/services/staff";

afterEach(() => {
  cleanup();
  linkSpy.calls.length = 0;
});

function isOwnerHref(href: unknown): boolean {
  const pathname =
    typeof href === "string"
      ? href
      : ((href as { pathname?: string } | null)?.pathname ?? "");
  return (
    pathname === "/owner" ||
    pathname.startsWith("/owner/") ||
    pathname.startsWith("/owner?") ||
    pathname.startsWith("/owner#")
  );
}

/** Every owner destination this render produced must ask for no prefetch. */
function expectOwnerLinksDoNotPrefetch(label: string) {
  const ownerLinks = linkSpy.calls.filter((call) => isOwnerHref(call.href));
  expect(ownerLinks.length, `${label}: no owner links were rendered`).toBeGreaterThan(0);
  for (const call of ownerLinks) {
    expect(
      call.prefetch,
      `${label}: ${String(call.href)} must not prefetch in the background`,
    ).toBe(false);
  }
}

describe("owner navigation — no background prefetch", () => {
  it("the phone navigation and its More menu", () => {
    render(
      <OwnerMobileNav
        navItems={TENANT_SURFACE_NAV.owner}
        sidebarGroups={OWNER_SIDEBAR_GROUPS}
      />,
    );
    expectOwnerLinksDoNotPrefetch("phone navigation");
  });

  it("the owner shell: sidebar, account and header", () => {
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Work</p>
      </OwnerShell>,
    );
    expectOwnerLinksDoNotPrefetch("owner shell");
    expect(within(screen.getByTestId("owner-header-account")).getByText("Account")).toBeTruthy();
  });

  it("the account control's Appearance link", () => {
    render(<OwnerAccountControl accountName="Divya Sharma" />);
    expectOwnerLinksDoNotPrefetch("account control");
  });

  it("the staff board row links", () => {
    const rows = [
      {
        id: "s1",
        personId: "person-1",
        fullName: "Asha Rao",
        userId: null,
        staffType: "coach",
        employedOn: null,
      },
    ] as unknown as StaffRow[];
    render(<StaffBoard rows={rows} />);
    expectOwnerLinksDoNotPrefetch("staff board");
  });
});

describe("the link facade's contract (control)", () => {
  it("leaves a non-owner destination's default prefetch untouched", () => {
    // CONTROL: shared renderers serve coach, reception and Ops too; their
    // destinations keep exactly the prefetch they ask for.
    render(
      <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={[]}>
        <p>Work</p>
      </OwnerShell>,
    );
    const nonOwner = linkSpy.calls.filter((call) => !isOwnerHref(call.href));
    for (const call of nonOwner) {
      expect(call.prefetch).toBeUndefined();
    }
  });
});
