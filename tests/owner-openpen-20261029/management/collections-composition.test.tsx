// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// Daily collections puts the evidence and the count decision side by
// side: "Payment evidence" (total, system cash, method breakdown) and
// "Count the cash" (the count, its variance and the reason rule). The
// day and facility stay explicit above both.

vi.mock("@/lib/actions/reconciliation", () => ({
  getDailyCollectionAction: async () => ({
    onDate: "2026-10-27",
    totalPaise: 1_820_000,
    cashPaise: 840_000,
    paymentCount: 3,
    byMethod: [
      { key: "cash", label: "Cash", count: 1, totalPaise: 840_000 },
      { key: "upi", label: "UPI", count: 2, totalPaise: 980_000 },
    ],
    byStaff: [
      { key: "staff-1", label: "Rhea Jain", count: 3, totalPaise: 1_820_000 },
    ],
    cashCount: null,
  }),
  confirmCashCountAction: async () => ({ ok: true, variancePaise: 0 }),
  reopenCashCountAction: async () => ({ ok: true }),
}));

import { CollectionsReport } from "@/components/reports/collections-report";

afterEach(cleanup);

describe("daily collections composition", () => {
  it("places payment evidence and the cash count beside each other", async () => {
    render(
      <CollectionsReport
        defaultDate="2026-10-27"
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        facilityLabel="Facility"
        canConfirm
        canReopen
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 2, name: "Payment evidence" }),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Count the cash" }),
    ).toBeTruthy();

    // The system cash figure is beside the count form, and the method
    // table stays evidence, not a second action.
    expect(screen.getByText("₹8,400.00")).toBeTruthy();
    expect(screen.getByText("UPI")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Confirm count for/i }),
    ).toBeTruthy();
  });
});
