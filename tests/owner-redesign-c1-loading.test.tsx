// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import OwnerHomeLoading from "@/app/(owner)/owner/loading";
afterEach(cleanup);
it("announces loading and follows Home's context, collections, shortcuts, actions and sessions order", () => {
  render(<OwnerHomeLoading />);
  const root = screen.getByTestId("owner-home-loading");
  expect(root.getAttribute("aria-busy")).toBe("true");
  expect(root.getAttribute("aria-label")).toBeTruthy();
  const ids = ["header", "summary", "shortcuts", "actions", "timeline"];
  const nodes = Array.from(root.querySelectorAll("[data-testid]"));
  const positions = ids.map(id => nodes.indexOf(screen.getByTestId(`owner-home-loading-${id}`)));
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(screen.getByTestId("owner-home-loading-summary").querySelectorAll("[data-skeleton-figure]")).toHaveLength(2);
});
