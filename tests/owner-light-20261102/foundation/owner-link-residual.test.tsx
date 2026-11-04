// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the two remaining owned renderers that still asked the
// framework for its default (automatic) prefetch on an OWNER destination.
//
//   - the shared create action: an owner create route must read on
//     navigation, while its same-page fragment branch stays a NATIVE
//     anchor (the browser's own fragment navigation, never the router);
//   - the shared stat card: an owner destination must not be prefetched,
//     and a non-owner destination keeps exactly the behaviour it had, so
//     coach, reception and Ops do not change.
//
// RED PROVENANCE: written BEFORE these two files import the facade. The
// spy is on the INSTALLED next/link, so the assertions read the actual
// prefetch the framework would receive (`undefined` = automatic), not a
// class or a string.

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

import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { StatCard } from "@/components/ui/StatCard";

afterEach(() => {
  cleanup();
  linkSpy.calls.length = 0;
});

describe("the shared create action", () => {
  it("reads an owner create route on navigation", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    expect(screen.getByRole("link", { name: "Add member" })).toBeTruthy();
    expect(linkSpy.calls).toHaveLength(1);
    expect(
      linkSpy.calls[0]?.prefetch,
      "an owner create route must not prefetch in the background",
    ).toBe(false);
  });

  it("keeps the same-page fragment branch a NATIVE anchor", () => {
    // CONTROL: the fragment form is the browser's own navigation — it
    // never goes through the framework link at all.
    render(<OwnerCreateAction href="#new-booking" label="New booking" />);
    const link = screen.getByRole("link", { name: "New booking" });
    expect(link.getAttribute("href")).toBe("#new-booking");
    expect(linkSpy.calls).toHaveLength(0);
    expect(link.hasAttribute("data-owner-create-action")).toBe(true);
  });
});

describe("the shared stat card", () => {
  it("reads an owner destination on navigation", () => {
    render(<StatCard label="Collected" value="₹1,000" href="/owner/reports" />);
    expect(linkSpy.calls).toHaveLength(1);
    expect(
      linkSpy.calls[0]?.prefetch,
      "an owner stat-card destination must not prefetch in the background",
    ).toBe(false);
  });

  it("keeps a non-owner destination's default prefetch", () => {
    // CONTROL: the card is shared with coach and reception; their
    // destinations are untouched.
    render(<StatCard label="Today" value="3" href="/coach/schedule" />);
    expect(linkSpy.calls).toHaveLength(1);
    expect(linkSpy.calls[0]?.prefetch).toBeUndefined();
  });
});
