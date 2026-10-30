// @vitest-environment jsdom
//
// Shared SegmentedTabs active-reveal contract (29 Oct 2026).
//
// The nav is a horizontal scroll container. A direct load or a route
// change that selects a tab beyond the right edge must reveal that tab
// inside the nav only — never scroll the page or move focus. jsdom has
// no layout, so this test supplies the nav/active geometry explicitly;
// real Chrome geometry remains a coordinator check.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

const TABS = [
  { key: "overview", label: "Overview", href: "/owner/members/m1?tab=overview" },
  { key: "payments", label: "Payments", href: "/owner/members/m1?tab=payments" },
  { key: "progress", label: "Progress", href: "/owner/members/m1?tab=progress" },
  { key: "notes", label: "Notes", href: "/owner/members/m1?tab=notes" },
  { key: "documents", label: "Documents", href: "/owner/members/m1?tab=documents" },
];

const originalGetRect = HTMLElement.prototype.getBoundingClientRect;
const originalClientWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
const originalScrollWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollWidth",
);

function rect(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    top: 0,
    bottom: 44,
    width,
    height: 44,
    x: left,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function getRect() {
    if (this.getAttribute("aria-label") === "Sections") return rect(0, 300);
    if (this.getAttribute("aria-current") === "page") {
      // Overview starts at zero; Documents starts 420px into the surface.
      return this.textContent?.trim() === "Overview"
        ? rect(0, 90)
        : rect(420, 90);
    }
    return rect(0, 90);
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.getAttribute("aria-label") === "Sections" ? 300 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      return this.getAttribute("aria-label") === "Sections" ? 600 : 0;
    },
  });
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetRect;
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }
  if (originalScrollWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollWidth",
      originalScrollWidth,
    );
  }
  vi.restoreAllMocks();
});

describe("SegmentedTabs active reveal", () => {
  it("reveals a direct-load active tab that starts beyond the right edge", () => {
    render(<SegmentedTabs tabs={TABS} active="documents" ariaLabel="Sections" />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.scrollLeft).toBeGreaterThan(0);
    expect(nav.scrollLeft).toBeLessThanOrEqual(300);
  });

  it("does not move the nav when the active tab is already visible", () => {
    render(<SegmentedTabs tabs={TABS} active="overview" ariaLabel="Sections" />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.scrollLeft).toBe(0);
  });

  it("scrolls back to a newly active tab on a route-style active change", () => {
    const { rerender } = render(
      <SegmentedTabs tabs={TABS} active="documents" ariaLabel="Sections" />,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav.scrollLeft).toBeGreaterThan(0);

    // Once the container is scrolled 300px, Overview sits off the left.
    nav.getBoundingClientRect = () => rect(0, 300);
    const overview = screen.getByRole("link", { name: "Overview" });
    overview.getBoundingClientRect = () => rect(-300, 90);

    rerender(
      <SegmentedTabs tabs={TABS} active="overview" ariaLabel="Sections" />,
    );
    expect(nav.scrollLeft).toBe(0);
  });

  it("keeps server links, aria-current and the 44px tab target", () => {
    render(<SegmentedTabs tabs={TABS} active="documents" ariaLabel="Sections" />);
    const active = screen.getByRole("link", { name: "Documents" });
    expect(active.getAttribute("href")).toBe("/owner/members/m1?tab=documents");
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("min-h-11");
    expect(active.className).toContain("flex-none");
  });
});
