// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): the OWNED Owner navigation
// still asks Next for opportunistic automatic prefetch.
//
// Runtime evidence (Root's browser run): in the normal production SPA, the
// member profile -> Edit -> Cancel journey stalls on an already-prefetched RSC
// payload even though the URLs are valid, the form is clean and the handlers
// are hydrated. Aborting ALL automatic prefetch requests makes the 21-journey
// sweep pass; route.continue control and target subsets still fail; idle direct
// RSC requests complete in 20-260 ms with and without the prefetch headers, so
// there is no proven server-await or database defect. Root's decision is an
// intentional Owner page read ON NAVIGATION instead of an opportunistic
// background prefetch — a per-Link UI setting, not a framework, caching or
// security-config patch.
//
// Foundation owns the shared facade `components/owner-ui/owner-link.tsx`. It
// does not exist yet in this checkout, so this test must NOT import it and must
// NOT manufacture an import-error RED. Instead it spies on the installed
// `next/link` and records the prefetch EACH rendered link requests. Today the
// Owner destinations request `undefined` (= automatic prefetch), so the Owner
// assertion fails on the intended behaviour itself.
//
// The facade contract (once Foundation transfers it): force `prefetch={false}`
// for an absolute app href whose path is exactly `/owner` or starts `/owner/`,
// `/owner?` or `/owner#` (including UrlObject.pathname), and forward the
// existing `prefetch` prop/default unchanged for every other destination. The
// `/ownerly` control below is the boundary that a naive `startsWith("/owner")`
// would get wrong.
//
// Controls kept in this file (they must stay meaningful, not merely green):
//   * a non-Owner destination keeps the default prefetch;
//   * an `/ownerly` destination is NOT an Owner page and keeps the default;
//   * every rendered destination keeps its authored href exactly.
//
// The component under test is real and owned: `SettingsSurfaceItems` renders
// the Owner Settings destination list on the actual `/owner/settings` page, fed
// here with the production `settingCategories()` data.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import {
  SettingsSurfaceItems,
  settingCategories,
  type SettingItem,
} from "@/components/settings/settings-surfaces";

/** Every Link render, in document order, with the prefetch it requested. */
const seen = vi.hoisted(() => [] as Array<{ href: string; prefetch: unknown }>);

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    __esModule: true,
    default: function SpyLink({
      href,
      prefetch,
      children,
    }: {
      href: string | { pathname?: string };
      prefetch?: boolean | null;
      children?: ReactNode;
    }) {
      const hrefString =
        typeof href === "string" ? href : (href.pathname ?? "");
      seen.push({ href: hrefString, prefetch });
      return React.createElement("a", { href: hrefString }, children);
    },
  };
});

afterEach(() => {
  cleanup();
  seen.length = 0;
});

/** The real production settings destinations, all Owner pages. */
const OWNER_ITEMS: SettingItem[] = settingCategories({
  ladderEnabled: true,
  multiLocation: true,
  canReadBookings: true,
}).flatMap((category) => category.items);

/** Destinations that are NOT Owner pages: a non-Owner route and the boundary. */
const NON_OWNER_ITEMS: SettingItem[] = [
  { href: "/login", label: "Sign in", detail: "A non-Owner route." },
  {
    href: "/ownerly",
    label: "Ownerly",
    detail: "Shares the /owner prefix but is not an Owner page.",
  },
];

describe("Owner navigation prefetch intent", () => {
  it("requests an intentional read, not an automatic prefetch, for Owner pages", () => {
    render(<SettingsSurfaceItems items={OWNER_ITEMS} />);

    // The list really renders the Owner destinations (a broken spy or an
    // empty render cannot pass this test).
    expect(seen.length).toBe(OWNER_ITEMS.length);

    const ownerLinks = seen.filter((link) =>
      /^\/owner(\/|\?|#|$)/.test(link.href),
    );
    expect(ownerLinks.length).toBe(OWNER_ITEMS.length);

    for (const link of ownerLinks) {
      // INTENDED RED today: these are `undefined` (automatic prefetch).
      expect(
        link.prefetch,
        `${link.href} must read on navigation, not prefetch in the background`,
      ).toBe(false);
    }
  });

  it("keeps the default prefetch for destinations that are not Owner pages", () => {
    render(<SettingsSurfaceItems items={NON_OWNER_ITEMS} />);

    const login = seen.find((link) => link.href === "/login");
    const boundary = seen.find((link) => link.href === "/ownerly");

    expect(login, "the non-Owner destination renders").toBeTruthy();
    expect(boundary, "the /ownerly boundary destination renders").toBeTruthy();

    // No `false` is forced on anyone else's links: the facade forwards the
    // existing prop/default, which here means "not passed".
    expect(login?.prefetch).toBeUndefined();
    expect(boundary?.prefetch).toBeUndefined();
  });

  it("does not alter the authored destination hrefs", () => {
    render(<SettingsSurfaceItems items={[...OWNER_ITEMS, ...NON_OWNER_ITEMS]} />);

    expect(seen.map((link) => link.href)).toEqual(
      [...OWNER_ITEMS, ...NON_OWNER_ITEMS].map((item) => item.href),
    );
  });
});
