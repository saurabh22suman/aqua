// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Foundation — the shared Owner create action.
//
// The contract (CONTRACT.md §9):
//
//   "components/owner-ui/owner-create-action.tsx exports
//    OwnerCreateAction({href:string,label:string,testId?:string,
//    className?:string}). It renders one accessible link, fixed round
//    56px mobile FAB above nav + safe area, desktop inline labelled
//    primary action. […] Permission-gated by page server before
//    rendering. It must not cover list actions/PWA controls on long
//    pages/short screens."
//
// The approved mock measures the floating action:
//
//   .fab { position:fixed; right:16px; z-index:60;
//          bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom));
//          width:56px; height:56px; border-radius:50%; }
//   html[data-fab="on"] .view { padding-bottom: calc(var(--nav-h) + 92px) }
//
// So the action is ONE link that is a round floating action on a phone
// and an inline labelled primary action on a desktop, and the content
// reserves the action's footprint ONLY on the page that carries it.
//
// jsdom cannot lay out a fixed box, so the geometry assertions pin the
// rendered class contract; the measured geometry proof is the Chrome
// script (owner-light-foundation-chrome.cjs), run by the coordinator on
// the combined application.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        // The marker tells a ROUTED link from a native anchor: the
        // framework link intercepts the click, so it never performs the
        // browser's own fragment navigation.
        { href: typeof href === "string" ? href : "#", ...rest, "data-routed-link": "true" },
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

import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";

afterEach(cleanup);

describe("OwnerCreateAction — one accessible link", () => {
  it("renders exactly one link, named by its label", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    // The accessible name is the label alone: the icon is decoration and
    // never becomes part of the name.
    expect(links[0]?.getAttribute("href")).toBe("/owner/members/new");
    expect(screen.getByRole("link", { name: "Add member" })).toBeTruthy();
  });

  it("keeps the label in the document for the desktop action", () => {
    render(<OwnerCreateAction href="/owner/bookings/new" label="New booking" />);
    expect(screen.getByText("New booking")).toBeTruthy();
  });

  it("accepts the caller's test id and class", () => {
    render(
      <OwnerCreateAction
        href="/owner/members/new"
        label="Add member"
        testId="members-create-action"
        className="owner-create-action"
      />,
    );
    const link = screen.getByRole("link", { name: "Add member" });
    expect(link.getAttribute("data-testid")).toBe("members-create-action");
    expect(link.className).toContain("owner-create-action");
  });
});

describe("OwnerCreateAction — the phone floating action", () => {
  it("is a fixed round 56px action above the navigation and the safe area", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = screen.getByRole("link", { name: "Add member" });

    expect(link.className).toContain("fixed");
    expect(link.className).toContain("h-14");
    expect(link.className).toContain("w-14");
    expect(link.className).toContain("rounded-full");
    // The offset is the navigation height + the gap + the safe area, so
    // the action never sits under the bottom navigation. The value has a
    // literal fallback, so the action floats correctly even in a
    // checkout that has not received the owner shell tokens yet.
    expect(link.className).toContain("bottom-[var(--owner-fab-bottom");
    expect(link.className).toContain("env(safe-area-inset-bottom)");
  });

  it("leaves the desktop action inline", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = screen.getByRole("link", { name: "Add member" });

    expect(link.className).toContain("lg:static");
    expect(link.className).toContain("lg:px-4");
  });
});

describe("OwnerCreateAction — a same-page fragment action", () => {
  it("is a NATIVE anchor, so the browser scrolls to and focuses the form", () => {
    render(<OwnerCreateAction href="#new-booking" label="New booking" />);
    const link = screen.getByRole("link", { name: "New booking" });

    // RED (actual Chrome, journeys r2): the routed link intercepted the
    // click, so the real "#new-booking" form was never scrolled to and
    // never focused — "Booking create action focuses actual form" FAILED.
    // The browser's OWN fragment navigation is what scrolls and focuses
    // a focusable target, so a fragment action must be a native anchor.
    expect(
      link.hasAttribute("data-routed-link"),
      "a same-page fragment action must be a native anchor, not the routed link",
    ).toBe(false);
  });

  it("keeps the exact fragment target and the shared contract", () => {
    render(<OwnerCreateAction href="#new-booking" label="New booking" testId="booking-create-action" />);
    const link = screen.getByRole("link", { name: "New booking" });

    expect(link.getAttribute("href")).toBe("#new-booking");
    expect(link.getAttribute("data-owner-create-action")).toBe("");
    expect(link.getAttribute("data-testid")).toBe("booking-create-action");
    expect(link.className).toContain("rounded-full");
    expect(link.className).toContain("h-14");
    // The label is the accessible name and the plus glyph is decorative.
    expect(screen.getByText("New booking")).toBeTruthy();
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the routed link for a real route", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = screen.getByRole("link", { name: "Add member" });

    // CONTROL: a route navigation is the framework's job and keeps the
    // framework link.
    expect(link.getAttribute("data-routed-link")).toBe("true");
    expect(link.getAttribute("href")).toBe("/owner/members/new");
  });
});

describe("OwnerCreateAction — the content clearance", () => {
  it("marks the action so the owner scope can reserve room for it", () => {
    render(<OwnerCreateAction href="/owner/members/new" label="Add member" />);
    const link = screen.getByRole("link", { name: "Add member" });

    // The marker is the hook the owner scope's :has() rule reads, so the
    // clearance grows ONLY on a page that carries the action.
    expect(link.hasAttribute("data-owner-create-action")).toBe(true);
  });
});
