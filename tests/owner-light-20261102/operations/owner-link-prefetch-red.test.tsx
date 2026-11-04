// @vitest-environment jsdom
//
// Owner navigation reliability — the RED for the shared OwnerLink facade
// (3 November 2026, Operations lane).
//
// Evidence the coordinator supplied: a normal production SPA profile →
// Edit → Cancel stalls on a prefetched RSC response; aborting ALL
// automatic prefetch requests makes the full 21 journeys pass (with the
// diagnostic-only errors preserved), while route.continue control and
// target subsets still fail; idle direct RSC requests complete in
// 20–260 ms with or without prefetch headers, so no server-await/DB
// defect is proven; the docker-equivalent standalone build reproduces it.
// Root has therefore chosen intentional Owner page reads ON NAVIGATION
// instead of opportunistic background prefetch — a supported per-Link UI
// setting, not a framework, security or caching-config patch.
//
// This file records what the OWNED rendered navigation ACTUALLY asks Next
// to do today. It is a spy on next/link: it asserts the behaviour of the
// links, not a source string, and it does NOT import the not-yet-created
// facade (a missing module is not a RED).
//
// The contract asserted below:
//   * an absolute app href that targets the Owner app — "/owner",
//     "/owner/…", "/owner?…", "/owner#…" — must request prefetch=false;
//   * every other destination keeps the existing prefetch prop/default
//     (so a shared component that also serves other roles is unchanged);
//   * the href (query and hash included), the classes, the accessible
//     name and the test id are passed through exactly as before.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type RequestedLink = {
  href: unknown;
  prefetch: unknown;
  className?: unknown;
  "aria-label"?: unknown;
  "data-testid"?: unknown;
};

const requested = vi.hoisted(() => [] as RequestedLink[]);

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: Record<string, unknown>) => {
      const { href, prefetch, children, ...rest } = props;
      requested.push({ href, prefetch, ...(rest as object) });
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { OwnerScheduleGrid } from "@/components/owner-schedule-grid";

afterEach(() => {
  cleanup();
  requested.length = 0;
});

/** The policy's Owner-destination test, stated independently of the facade. */
function isOwnerHref(href: unknown): boolean {
  if (typeof href === "string") {
    return (
      href === "/owner" ||
      href.startsWith("/owner/") ||
      href.startsWith("/owner?") ||
      href.startsWith("/owner#")
    );
  }
  if (href && typeof href === "object" && "pathname" in href) {
    const pathname = (href as { pathname?: unknown }).pathname;
    return (
      typeof pathname === "string" &&
      (pathname === "/owner" ||
        pathname.startsWith("/owner/") ||
        pathname.startsWith("/owner?") ||
        pathname.startsWith("/owner#"))
    );
  }
  return false;
}

const SESSION = {
  id: "s-1",
  sessionDate: "2026-11-02",
  startsAt: "2026-11-02T12:30:00.000Z",
  endsAt: "2026-11-02T13:30:00.000Z",
  status: "scheduled",
  batchId: "b-1",
  batchName: "Evening Squad",
  capacity: 12,
  enrolled: 8,
  locationId: "loc-1",
  locationName: "Worli",
  coachName: "Asha Menon",
};

/**
 * The owned schedule grid — an Owner navigation surface.
 *
 * The four view hrefs are deliberately omitted so the shared
 * SegmentedTabs (another lane's component) renders no link: every
 * next/link recorded here comes from this lane's own files
 * (owner-schedule-grid.tsx and owner-calendar-nav.tsx).
 */
function renderGrid(
  overrides: {
    prevHref?: string;
    nextHref?: string;
    canManagePrograms?: boolean;
    canManageExceptions?: boolean;
  } = {},
) {
  return render(
    <OwnerScheduleGrid
      view="week"
      locations={[]}
      sessions={[SESSION]}
      days={["2026-11-02"]}
      monthCells={null}
      prevHref={
        overrides.prevHref ??
        "/owner/schedule?view=week&date=2026-10-26&location=loc-1"
      }
      nextHref={
        overrides.nextHref ??
        "/owner/schedule?view=week&date=2026-11-09&location=loc-1"
      }
      todayHref="/owner/schedule?view=week&date=2026-11-02"
      canManagePrograms={overrides.canManagePrograms ?? true}
      canManageExceptions={overrides.canManageExceptions ?? true}
    />,
  );
}

describe("Owner navigation asks Next not to prefetch", () => {
  it("requests prefetch=false for every Owner destination, query and hash included", () => {
    renderGrid();

    const ownerLinks = requested.filter((link) => isOwnerHref(link.href));
    // The toolbar's three date controls, the exceptions link and the
    // "add a session" link — all rendered by this lane's files.
    expect(ownerLinks.length).toBeGreaterThanOrEqual(5);
    for (const link of ownerLinks) {
      expect(
        link.prefetch,
        `owner destination ${String(link.href)} must not prefetch`,
      ).toBe(false);
    }
  });

  it("still recognises an Owner href that carries a query or a hash", () => {
    renderGrid({ prevHref: "/owner/schedule?view=day&date=2026-11-02#track" });

    const withQuery = requested.find(
      (link) => link.href === "/owner/schedule?view=day&date=2026-11-02#track",
    );
    expect(withQuery).toBeTruthy();
    // The href itself is preserved byte for byte…
    expect(withQuery!.href).toBe(
      "/owner/schedule?view=day&date=2026-11-02#track",
    );
    // …and the Owner destination is still recognised.
    expect(withQuery!.prefetch).toBe(false);
  });

  it("leaves a non-Owner destination and the /ownerly boundary on the existing default", () => {
    renderGrid({
      prevHref: "/reports/collections?view=trends",
      nextHref: "/ownerly?date=2026-11-02",
    });

    const reports = requested.find(
      (link) => link.href === "/reports/collections?view=trends",
    );
    expect(reports).toBeTruthy();
    expect(
      reports!.prefetch,
      "a non-Owner destination keeps the existing prefetch default",
    ).toBeUndefined();

    const boundary = requested.find(
      (link) => link.href === "/ownerly?date=2026-11-02",
    );
    expect(boundary).toBeTruthy();
    expect(
      boundary!.prefetch,
      "/ownerly is not an Owner destination and keeps the default",
    ).toBeUndefined();
  });

  it("keeps the props the link already passes today", () => {
    renderGrid();

    const previous = requested.find(
      (link) =>
        link.href === "/owner/schedule?view=week&date=2026-10-26&location=loc-1",
    );
    expect(previous).toBeTruthy();
    expect(previous!["data-testid"]).toBe("calendar-previous");
    expect(previous!["aria-label"]).toBe("Previous week");
    // The link keeps the shared Button primitive's own class contract.
    expect(String(previous!.className)).toContain("min-h-12");
    expect(String(previous!.className)).toContain("rounded-ctl");
  });

  it("adds no link for a caller without the program permissions", () => {
    renderGrid({ canManagePrograms: false, canManageExceptions: false });

    expect(requested.some((link) => link.href === "/owner/programs")).toBe(false);
    expect(requested.some((link) => link.href === "/owner/sessions")).toBe(false);
    // The date controls are still Owner links and still gated by nothing
    // but the surface itself.
    expect(requested.some((link) => isOwnerHref(link.href))).toBe(true);
  });
});
