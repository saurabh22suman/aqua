// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026) — the owner's enquiry
// capture must not FORCE a smooth scroll.
//
// Root review (3 Nov, round 3): the capture's open effect calls
// scrollIntoView with `behavior: "smooth"`, so a reader who asked the
// platform for reduced motion still gets an animated scroll every time
// they open the capture. The product's own motion contract
// (docs/design-system/motion.md) is explicit: "reduced mode removes
// transforms/reordering/scroll animation and uses immediate feedback.
// Never force smooth scrolling."
//
// The contract this file pins:
//
//   * with `prefers-reduced-motion: reduce`, opening the capture makes
//     NO call that asks for `behavior: "smooth"` — the reveal keeps
//     the browser's own default scrolling;
//   * the reveal itself is NOT removed: the field is still brought
//     into view and still focused, because the owner's press is the
//     explicit intent that made the capture reachable;
//   * nothing is focused on arrival, and reception's always-visible
//     capture is still never focused and never scrolled.
//
// No database: the board's only server action is stubbed.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createEnquiryAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/enquiries", () => ({
  createEnquiryAction: (...args: unknown[]) => createEnquiryAction(...args),
}));

import { EnquiriesBoard } from "@/components/enquiries-board";

const LOCATION = "22222222-2222-4222-8222-222222222222";

const scrollIntoView = vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>();

const originalMatchMedia =
  typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined;

/**
 * The media query list a reader who asked for reduced motion gets.
 * Everything else answers honestly (nothing matches a width or a
 * colour scheme that jsdom cannot know).
 */
function mediaQueryList(query: string): MediaQueryList {
  return {
    matches: /prefers-reduced-motion:\s*reduce/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

function renderBoard(variant: "oversight" | "front-desk") {
  return render(
    <EnquiriesBoard
      initialEnquiries={[]}
      locations={[{ id: LOCATION, name: "Worli Main" }]}
      canWrite
      variant={variant}
    />,
  );
}

/** Every call that asked the browser to ANIMATE the scroll. */
function forcedSmoothCalls() {
  return scrollIntoView.mock.calls.filter(
    ([options]) =>
      typeof options === "object" &&
      options !== null &&
      options.behavior === "smooth",
  );
}

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The owner's capture brings its name field into view when it opens.
  Element.prototype.scrollIntoView =
    scrollIntoView as unknown as Element["scrollIntoView"];
});

beforeEach(() => {
  createEnquiryAction.mockReset();
  createEnquiryAction.mockResolvedValue({ id: "e1" });
  scrollIntoView.mockClear();
  // The reader asked the platform for reduced motion.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => mediaQueryList(query),
  });
});

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  cleanup();
});

describe("the owner's enquiry capture under reduced motion", () => {
  // RED: the open effect asks for `behavior: "smooth"`, so the capture
  // animates into view even though the reader asked for reduced motion.
  it("does not force a smooth scroll when the reader asked for reduced motion", async () => {
    renderBoard("oversight");

    fireEvent.click(screen.getByRole("button", { name: "Add enquiry" }));

    await waitFor(() =>
      expect(screen.getByTestId("enquiry-capture-name")).toBeTruthy(),
    );
    const field = screen.getByTestId("enquiry-capture-name");
    await waitFor(() => expect(document.activeElement).toBe(field));

    // The reveal is kept: the field is still brought into the viewport.
    expect(scrollIntoView).toHaveBeenCalled();

    // …but no call may FORCE the animated scroll.
    expect(forcedSmoothCalls()).toEqual([]);
  });

  // CONTROL: arrival still focuses nothing — the owner did not ask for
  // a field, so the page must not steal their place.
  it("focuses nothing on arrival", () => {
    renderBoard("oversight");

    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  // CONTROL: reception's capture is ALWAYS visible, so there is nothing
  // to reveal — it is never focused and never scrolled.
  it("never focuses or scrolls reception's always-visible capture", () => {
    renderBoard("front-desk");

    const field = screen.getByTestId("enquiry-capture-name");
    expect(field).toBeTruthy();
    expect(document.activeElement).not.toBe(field);
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
