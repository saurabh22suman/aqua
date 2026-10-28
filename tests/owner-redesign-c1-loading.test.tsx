// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import OwnerHomeLoading from "@/app/(owner)/owner/loading";
import { OwnerHomeMetrics } from "@/components/owner-home/owner-home-metrics";

// Owner redesign · System lane — the owner Home's LOADING state.
//
// The Home's loading skeleton is the first thing the owner sees on a
// cold load, and the audit that recorded the cold-load blank screen
// asked for a placeholder block that "matches the layout that's about
// to arrive".
//
// The approved composition (DESIGN.md §7 and the Lavender Option B
// amendment) has since changed: the screen opens with the day/academy/
// scope, then the summary figures, then one dominant action, then the
// day's classes BESIDE the attention queue, then the money band. The
// skeleton still mirrored the pre-Lavender composition (a money hero,
// an attention list, a registers card, stat chips and lane strips), so
// the page visibly rearranged itself when the data arrived.
//
// RED status at the time of writing: the skeleton carried the OLD
// sections and had no landmark for the money band or the actions.

afterEach(cleanup);

describe("the owner Home loading state", () => {
  it("mirrors the approved composition, in order", () => {
    render(<OwnerHomeLoading />);
    const order = [
      "owner-home-loading-header",
      "owner-home-loading-summary",
      "owner-home-loading-actions",
      "owner-home-loading-timeline",
      "owner-home-loading-attention",
      "owner-home-loading-money",
    ];
    const positions = order.map((testId) => {
      const element = screen.getByTestId(testId);
      expect(element).toBeTruthy();
      // The order in the document, not the order of the assertions.
      return Array.from(document.querySelectorAll("[data-testid]")).indexOf(
        element,
      );
    });
    for (const [index, position] of positions.entries()) {
      expect(
        position,
        `${order[index]} must come before ${order[index + 1] ?? "the end"}`,
      ).toBeGreaterThan(-1);
      if (index > 0) {
        expect(
          position,
          `${order[index]} must come after ${order[index - 1]}`,
        ).toBeGreaterThan(positions[index - 1]!);
      }
    }
  });

  it("holds a place for the day's classes BESIDE the attention queue", () => {
    render(<OwnerHomeLoading />);
    const timeline = screen.getByTestId("owner-home-loading-timeline");
    const attention = screen.getByTestId("owner-home-loading-attention");
    // They are siblings in the same two-column band, not stacked
    // placeholders of two different pages.
    expect(timeline.parentElement).toBe(attention.parentElement);
  });

  it("keeps the summary at four figures", () => {
    render(<OwnerHomeLoading />);
    const summary = screen.getByTestId("owner-home-loading-summary");
    expect(summary.querySelectorAll("[data-skeleton-figure]")).toHaveLength(4);
  });

  it("mirrors the REAL Home's responsive branches, not just its node count", () => {
    // The independent review found that the skeleton rendered four
    // tiles at every width and switched to four columns at `lg`, while
    // the real Home shows two money cards plus a compact line below lg,
    // a 2×2 block from 1024 to 1179px, and four columns only at the
    // `wide` breakpoint. The page therefore rearranged itself when the
    // data arrived — the opposite of the skeleton's purpose.
    //
    // The contract is not "four nodes": it is the SAME responsive
    // geometry as the real Home, so the skeleton is compared against the
    // real component's own class contract.
    render(
      <OwnerHomeMetrics
        cards={[
          { key: "a", label: "Collected", value: "₹1", tone: "money", icon: { node: null, tone: "good" } },
          { key: "b", label: "Overdue", value: "₹0", tone: "paper", icon: { node: null, tone: "neutral" } },
          { key: "c", label: "Active", value: 1, tone: "info", icon: { node: null, tone: "water" }, compactOnly: true },
          { key: "d", label: "Sessions", value: 1, tone: "butter", icon: { node: null, tone: "marine" }, compactOnly: true },
        ]}
        compactSummary="32 active swimmers"
      />,
    );
    const realGrid = screen.getByTestId("owner-home-metrics");
    const realLine = screen.getByTestId("owner-home-compact-summary");
    const realCompactWrapper = Array.from(realGrid.children).find((child) =>
      (child.getAttribute("class") ?? "").includes("lg:contents"),
    );
    const responsive = (source: string) =>
      (source.match(/(?:[a-z]+:)?grid-cols-\d|(?:[a-z]+:)?contents|lg:hidden/g) ?? [])
        .sort()
        .join(" ");

    cleanup();
    render(<OwnerHomeLoading />);
    const skeletonGrid = screen.getByTestId("owner-home-loading-summary");
    const skeletonLine = screen.getByTestId("owner-home-loading-compact-summary");
    const skeletonCompactWrapper = Array.from(skeletonGrid.children).find((child) =>
      (child.getAttribute("class") ?? "").includes("lg:contents"),
    );

    // The grid: the same columns at the same breakpoints.
    expect(responsive(skeletonGrid.className)).toBe(responsive(realGrid.className));
    // The compact line: shown below the shell breakpoint only.
    expect(responsive(skeletonLine.className)).toBe(responsive(realLine.className));
    // The compact-only figures: hidden from the phone layout, a grid
    // item of their own from the shell breakpoint up.
    expect(responsive(skeletonCompactWrapper?.getAttribute("class") ?? "")).toBe(
      responsive(realCompactWrapper?.getAttribute("class") ?? ""),
    );
  });

  it("dresses its placeholders with the approved control radius", () => {
    render(<OwnerHomeLoading />);
    const actions = screen.getByTestId("owner-home-loading-actions");
    // The dominant action placeholder is a control: the 10px control
    // radius, not the old card radius.
    expect(actions.querySelector(".rounded-ctl")).toBeTruthy();
  });

  it("is announced as busy, so a screen reader knows the page is loading", () => {
    render(<OwnerHomeLoading />);
    const root = screen.getByTestId("owner-home-loading");
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("aria-label")).toBeTruthy();
  });
});
