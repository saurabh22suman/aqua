// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the create action's plus is visible on a DESKTOP too.
//
// Human requirement: a consistent + wherever creating fits, on every
// viewport. The Root's actual production Chrome run
// (.playwright-mcp/create-desktop-red-20261103/create-desktop.json)
// measured the shared action on /owner/members ("Add member") and
// /owner/staff ("Add staff") with `iconDisplay: none`, `iconWidth: 0`,
// `iconHeight: 0` while the label was visible — two intended failures
// before any source edit. The cause is the icon's `lg:hidden`.
//
// This file is the RENDERED unit guard; the geometry itself is proven by
// the Root's Chrome run (the same script is copied into this folder as
// owner-create-desktop-chrome.cjs). A class assertion here is not a
// substitute for that measurement, and the comment on each block says so.
//
// RED PROVENANCE: written before the source edit — the icon still carries
// `lg:hidden`, so the first assertion fails on the rendered element.

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

import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";

afterEach(cleanup);

function actionElement(): HTMLElement {
  const link = screen.getByRole("link", { name: /Add member/ });
  return link as HTMLElement;
}

describe("the create action's plus glyph", () => {
  it("is present on every viewport, never hidden on a desktop", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = actionElement();
    const icon = link.querySelector("svg");

    expect(icon, "the action renders its plus glyph").not.toBeNull();
    // The DESKTOP plus must not be switched off (the Root measured
    // `display: none`, width/height 0). The real geometry check is the
    // Chrome run; this pins the rendered cause.
    expect(icon?.getAttribute("class") ?? "").not.toContain("lg:hidden");
    // It stays decorative: the label is the accessible name.
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(link.textContent).toContain("Add member");
  });

  it("keeps the phone floating action exactly as it was", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = actionElement();

    // The phone geometry, the offset token and the desktop shape are
    // unchanged by the glyph fix.
    expect(link.className).toContain("rounded-full");
    expect(link.className).toContain("h-14");
    expect(link.className).toContain("w-14");
    expect(link.className).toContain("bottom-[var(--owner-fab-bottom");
    expect(link.className).toContain("lg:rounded-ctl");
    expect(link.getAttribute("data-owner-create-action")).toBe("");
  });

  it("keeps one link, a routed route and a native fragment", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Add member" }).getAttribute("href")).toBe(
      "/owner/members/new",
    );
    cleanup();

    render(<OwnerCreateAction href="#new-booking" label="New booking" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "New booking" }).getAttribute("href")).toBe(
      "#new-booking",
    );
  });
});
