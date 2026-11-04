// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

// Collections over time — the bar plot must carry readable date/INR
// context and a keyboard-reachable exact table. No new chart library.

import { CollectionsExpensesCard } from "@/components/reports/analytics-cards";

afterEach(cleanup);

const SERIES = {
  totalPaise: 4_400_00,
  expensesPaise: null,
  byDay: [
    { date: "2026-10-26", paise: 1_200_00 },
    { date: "2026-10-27", paise: 3_200_00 },
  ],
};

describe("collections over time chart context", () => {
  it("keeps the context visible and opens the exact table from a disclosure", () => {
    render(<CollectionsExpensesCard series={SERIES} />);

    expect(screen.getByText(/26 Oct 2026.*27 Oct 2026/i)).toBeTruthy();
    expect(screen.getByText(/INR per day/i)).toBeTruthy();

    const summary = screen.getByText("View data table");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.className).toMatch(/min-h-(11|12)/);
    const details = summary.closest("details");
    expect(details?.open).toBe(false);

    // The exact table is retained inside the disclosure and reachable when it
    // opens; it is not an always-expanded 31-row block.
    fireEvent.click(summary);
    expect(details?.open).toBe(true);

    const region = screen.getByRole("region", {
      name: /collections by day table/i,
    });
    expect(region.getAttribute("tabindex")).toBe("0");

    const table = within(region).getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Date" })).toBeTruthy();
    expect(
      within(table).getByRole("columnheader", { name: "Collected" }),
    ).toBeTruthy();
    expect(within(table).getByText("26 Oct 2026")).toBeTruthy();
    expect(within(table).getByText("₹1,200.00")).toBeTruthy();
    expect(within(table).getByText("27 Oct 2026")).toBeTruthy();
    expect(within(table).getByText("₹3,200.00")).toBeTruthy();
  });

  it("keeps the empty state truthful", () => {
    render(
      <CollectionsExpensesCard
        series={{ totalPaise: 0, expensesPaise: null, byDay: [] }}
      />,
    );
    expect(screen.getByText(/No payments recorded in this period/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
