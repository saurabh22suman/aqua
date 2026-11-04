// @vitest-environment jsdom
//
// The header's record search — VISIBLE copy (tranche 3, 31 Oct 2026).
//
// The coordinator's Chrome sweep found the placeholder "Search members,
// enquiries, payments" visibly truncated in BOTH actual Owner Home
// screenshots — on the 390 px phone and in the 300 px desktop control.
// A truncated placeholder reads as a broken field, and it is the first
// thing on the screen the owner looks at.
//
// The contract this file pins:
//
//   1. The VISIBLE placeholder is short: "Search club".
//   2. The ACCESSIBLE name keeps the descriptive detail, so the field
//      still says what it searches for.
//   3. Nothing else about the control changes — the same query, the
//      same action, the same results, the same clearing and the same
//      keyboard behaviour.
//
// This is header copy only: no layout, no grants, no query change.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/actions/global-search", () => ({
  globalSearchAction: async () => [],
}));

import { GlobalSearch } from "@/components/global-search";

afterEach(cleanup);

describe("the header search — visible copy", () => {
  it("shows a short visible placeholder that fits the control", () => {
    render(<GlobalSearch />);
    const input = screen.getByTestId("global-search-input");
    const placeholder = input.getAttribute("placeholder") ?? "";
    expect(placeholder).toBe("Search club");
    // The defect was a placeholder long enough to truncate.
    expect(placeholder.length).toBeLessThanOrEqual(16);
  });

  it("keeps a descriptive accessible name", () => {
    render(<GlobalSearch />);
    const input = screen.getByRole("textbox", {
      name: /search members, enquiries and payments/i,
    });
    expect(input.getAttribute("data-testid")).toBe("global-search-input");
  });

  it("still searches, and still clears", async () => {
    const action = vi.fn(async () => []);
    render(<GlobalSearch searchAction={action} />);
    const input = screen.getByTestId("global-search-input");
    fireEvent.change(input, { target: { value: "aar" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledWith("aar"));
    await screen.findByTestId("global-search-results");
    // The clear control is unchanged.
    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect((screen.getByTestId("global-search-input") as HTMLInputElement).value).toBe("");
  });
});
