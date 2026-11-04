// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import OwnerHomeLoading from "@/app/(owner)/owner/loading";
afterEach(cleanup);
it("announces loading and follows Home's context, collections and sessions order", () => {
  render(<OwnerHomeLoading />);
  const root = screen.getByTestId("owner-home-loading");
  expect(root.getAttribute("aria-busy")).toBe("true");
  expect(root.getAttribute("aria-label")).toBeTruthy();
  // The approved composition: header → collections card → sessions.
  const ids = ["header", "summary", "timeline"];
  const nodes = Array.from(root.querySelectorAll("[data-testid]"));
  const positions = ids.map(id => nodes.indexOf(screen.getByTestId(`owner-home-loading-${id}`)));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  // The two honest collection figures share one two-column pair.
  const figures = screen
    .getByTestId("owner-home-loading-summary")
    .querySelectorAll("[data-skeleton-figure]");
  expect(figures).toHaveLength(2);
  expect(figures[0]!.parentElement?.className).toContain("grid-cols-2");
});

// The approved Home has NO separate shortcut box and NO quick-actions box:
// the loading skeleton must not paint phantom blocks that the real page no
// longer has. It follows header → collections → sessions.
it("paints the approved Home skeleton with no phantom shortcut or action blocks", () => {
  render(<OwnerHomeLoading />);
  const root = screen.getByTestId("owner-home-loading");
  expect(root.getAttribute("aria-busy")).toBe("true");
  // The two honest figures of the collections card.
  expect(
    screen.getByTestId("owner-home-loading-summary").querySelectorAll("[data-skeleton-figure]"),
  ).toHaveLength(2);
  // No removed block is painted.
  expect(screen.queryByTestId("owner-home-loading-shortcuts")).toBeNull();
  expect(screen.queryByTestId("owner-home-loading-actions")).toBeNull();
  // Header, then the collections card, then the sessions card.
  const order = ["header", "summary", "timeline"].map((id) =>
    screen.getByTestId(`owner-home-loading-${id}`),
  );
  expect(
    order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
