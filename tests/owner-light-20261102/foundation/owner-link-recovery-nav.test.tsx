// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the last two direct framework links that reach an OWNER
// destination: the owner error boundary's recovery link and the shared
// bottom navigation when it is given the owner items.
//
// Both now go through the reviewed OwnerLink facade, so an owner
// destination reads on navigation. The bottom navigation is SHARED with
// coach and reception, so their destinations must keep exactly the
// prefetch they had.
//
// RED PROVENANCE: written BEFORE either file imports the facade. The spy
// is on the installed next/link, so the assertions read the actual
// prefetch the framework would receive (`undefined` = automatic).

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
  usePathname: () => "/owner",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import OwnerErrorBoundary from "@/app/(owner)/owner/error";
import { BottomNav } from "@/components/bottom-nav";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

afterEach(() => {
  cleanup();
  linkSpy.calls.length = 0;
});

describe("the owner error boundary's recovery link", () => {
  it("reads the dashboard on navigation", () => {
    render(<OwnerErrorBoundary error={new Error("boom")} reset={() => {}} />);

    // The recovery action is still a real link with its own href.
    const recovery = screen.getByRole("link", { name: "Back to dashboard" });
    expect(recovery.getAttribute("href")).toBe("/owner");
    expect(linkSpy.calls).toHaveLength(1);
    expect(
      linkSpy.calls[0]?.prefetch,
      "the recovery link must not prefetch the dashboard in the background",
    ).toBe(false);
  });
});

describe("the shared bottom navigation", () => {
  it("does not prefetch the owner destinations", () => {
    render(<BottomNav items={TENANT_SURFACE_NAV.owner} />);

    const ownerCalls = linkSpy.calls.filter((call) =>
      String(call.href).startsWith("/owner"),
    );
    expect(ownerCalls.length).toBeGreaterThan(0);
    for (const call of ownerCalls) {
      expect(
        call.prefetch,
        `${String(call.href)} must not prefetch in the background`,
      ).toBe(false);
    }
  });

  it("keeps the coach and reception destinations exactly as they were", () => {
    // CONTROL: the navigation is shared; only owner destinations change.
    render(<BottomNav items={TENANT_SURFACE_NAV.coach} />);
    expect(linkSpy.calls.length).toBeGreaterThan(0);
    for (const call of linkSpy.calls) {
      expect(call.prefetch).toBeUndefined();
    }
    cleanup();
    linkSpy.calls.length = 0;
    render(<BottomNav items={TENANT_SURFACE_NAV.reception} />);
    for (const call of linkSpy.calls) {
      expect(call.prefetch).toBeUndefined();
    }
  });
});
