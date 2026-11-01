// @vitest-environment jsdom
//
// Mobile slice — bounded comparison-table scroll region.
//
// DataTable renders a real <table> with a 640px minimum width, so a phone
// must be able to scroll it sideways. The scroll container therefore needs
// to be a named, focusable region; otherwise a keyboard-only reader cannot
// reach the columns that are off-screen.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DataTable } from "@/components/ui/DataTable";

afterEach(cleanup);

const rows = [
  { id: "1", member: "Synthetic swimmer", invoice: "INV/2026-27/0001", due: "₹1,800" },
];

describe("DataTable — bounded comparison scroll", () => {
  it("names and focuses the horizontal scroll region", () => {
    render(
      <DataTable
        testId="comparison-table"
        scrollLabel="Outstanding invoices"
        columns={[
          { key: "member", label: "Member", render: (row) => row.member },
          { key: "invoice", label: "Invoice", render: (row) => row.invoice },
          { key: "due", label: "Due", align: "right", render: (row) => row.due },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    const region = screenRegion();
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBe("Outstanding invoices");
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-x-auto");
  });

  it("keeps a useful default name for existing callers", () => {
    render(
      <DataTable
        testId="default-comparison"
        columns={[{ key: "member", label: "Member", render: (row) => row.member }]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    const region = screenRegion();
    expect(region.getAttribute("role")).toBe("region");
    expect(region.getAttribute("aria-label")).toBeTruthy();
  });
});

function screenRegion(): HTMLElement {
  const region = document.querySelector('[data-testid="comparison-table"], [data-testid="default-comparison"]');
  if (!(region instanceof HTMLElement)) throw new Error("scroll region not found");
  return region;
}
