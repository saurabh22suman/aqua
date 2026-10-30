// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Daily collections — one date control, the app-wide day-first DateField.
//
// The reporting day is ISO in state/query. The visible control must read
// dd/mm/yyyy, and an invalid typed date must not navigate to, request, or
// silently submit a fabricated/stale ISO day.

const getDailyCollectionAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/reconciliation", () => ({
  getDailyCollectionAction,
  confirmCashCountAction: async () => ({ ok: true, variancePaise: 0 }),
  reopenCashCountAction: async () => ({ ok: true }),
}));

import { CollectionsReport } from "@/components/reports/collections-report";

afterEach(() => {
  cleanup();
  getDailyCollectionAction.mockReset();
});

const REPORT = {
  onDate: "2026-10-29",
  totalPaise: 1_820_000,
  cashPaise: 840_000,
  paymentCount: 3,
  byMethod: [{ key: "cash", label: "Cash", count: 1, totalPaise: 840_000 }],
  byStaff: [],
  cashCount: null,
};

function renderReport() {
  getDailyCollectionAction.mockResolvedValue(REPORT);
  return render(
    <CollectionsReport
      defaultDate="2026-10-29"
      locations={[{ id: "loc-1", name: "Worli Main" }]}
      facilityLabel="Facility"
      canConfirm
      canReopen
    />,
  );
}

describe("daily collections date control", () => {
  it("shows the approved day-first date instead of the native picker format", async () => {
    renderReport();

    const date = screen.getByTestId("collections-date") as HTMLInputElement;
    expect(date.value).toBe("29/10/2026");
    expect(date.getAttribute("inputmode")).toBe("numeric");
  });

  it("does not request a fabricated day for an invalid typed date", async () => {
    renderReport();
    await waitFor(() => expect(getDailyCollectionAction).toHaveBeenCalledTimes(1));

    const date = screen.getByTestId("collections-date") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "31/02/2026" } });

    expect(date.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText(/pick a date to see collections/i),
    ).toBeTruthy();
    for (const call of getDailyCollectionAction.mock.calls) {
      expect(call[0].onDate).not.toBe("2026-02-31");
      expect(call[0].onDate).not.toBe("");
    }
    expect(getDailyCollectionAction).toHaveBeenCalledTimes(1);
  });

  it("keeps ISO state and the selected facility for a valid typed date", async () => {
    renderReport();
    await waitFor(() => expect(getDailyCollectionAction).toHaveBeenCalledTimes(1));

    const date = screen.getByTestId("collections-date") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "30/10/2026" } });

    await waitFor(() =>
      expect(getDailyCollectionAction).toHaveBeenLastCalledWith({
        onDate: "2026-10-30",
        locationId: "loc-1",
      }),
    );
    expect(date.value).toBe("30/10/2026");
  });
});
