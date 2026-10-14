// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — reconciliation evidence and action
// are bound to the same date/facility: a scope change clears the
// actionable report and the count draft, an older response cannot
// render under the new selection, and confirmation names its scope.

const getDailyCollectionAction = vi.hoisted(() => vi.fn());
const confirmCashCountAction = vi.hoisted(() => vi.fn());
const reopenCashCountAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/reconciliation", () => ({
  getDailyCollectionAction,
  confirmCashCountAction,
  reopenCashCountAction,
}));

import { CollectionsReport } from "@/components/reports/collections-report";
import type { DailyCollection } from "@/lib/services/reconciliation";

const LOC_A = { id: "11111111-1111-4111-8111-111111111111", name: "Worli" };
const LOC_B = { id: "22222222-2222-4222-8222-222222222222", name: "Andheri" };

function report(overrides: Partial<DailyCollection> = {}): DailyCollection {
  return {
    onDate: "2026-10-09",
    totalPaise: 120000,
    paymentCount: 2,
    cashPaise: 100000,
    cafePaise: 0,
    cafeOrders: 0,
    byMethod: [],
    byStaff: [],
    cashCount: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CollectionsReport scope binding (P1)", () => {
  it("clears the count draft and re-fetches when the facility changes", async () => {
    getDailyCollectionAction
      .mockResolvedValueOnce(report())
      .mockResolvedValueOnce(report({ cashPaise: 5000 }));
    render(
      <CollectionsReport
        defaultDate="2026-10-09"
        locations={[LOC_A, LOC_B]}
        facilityLabel="Facility"
        canConfirm
        canReopen={false}
      />,
    );

    await screen.findByRole("button", { name: /confirm count/i });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1200" },
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: LOC_B.id },
    });

    await waitFor(() =>
      expect(getDailyCollectionAction).toHaveBeenLastCalledWith({
        onDate: "2026-10-09",
        locationId: LOC_B.id,
      }),
    );
    await screen.findByRole("button", { name: /confirm count/i });
    // The draft from facility A must not carry into facility B.
    expect((screen.getByPlaceholderText("0.00") as HTMLInputElement).value).toBe("");
  });

  it("discards a late response for the previous date", async () => {
    const slowFirst = deferred<DailyCollection>();
    const fastSecond = deferred<DailyCollection>();
    getDailyCollectionAction
      .mockImplementationOnce(() => slowFirst.promise)
      .mockImplementationOnce(() => fastSecond.promise);

    render(
      <CollectionsReport
        defaultDate="2026-10-09"
        locations={[LOC_A]}
        facilityLabel="Facility"
        canConfirm
        canReopen={false}
      />,
    );
    // Change the date while the first load is still pending.
    fireEvent.change(screen.getByDisplayValue("2026-10-09"), {
      target: { value: "2026-10-10" },
    });
    await waitFor(() => expect(getDailyCollectionAction).toHaveBeenCalledTimes(2));

    fastSecond.resolve(report({ onDate: "2026-10-10" }));
    await waitFor(() =>
      expect(screen.getByText(/Collected on 2026-10-10/)).toBeTruthy(),
    );
    // The superseded response arrives afterwards and is ignored.
    slowFirst.resolve(report({ onDate: "2026-10-09" }));
    await waitFor(() => expect(screen.queryByText(/Collected on 2026-10-09/)).toBeNull());
  });

  it("names the confirmed scope in the outcome message", async () => {
    getDailyCollectionAction.mockResolvedValue(report());
    confirmCashCountAction.mockResolvedValue({ ok: true, variancePaise: 0 });

    render(
      <CollectionsReport
        defaultDate="2026-10-09"
        locations={[LOC_A, LOC_B]}
        facilityLabel="Facility"
        canConfirm
        canReopen={false}
      />,
    );
    await screen.findByRole("button", { name: /confirm count/i });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/Worli/),
    );
    expect(confirmCashCountAction).toHaveBeenCalledWith({
      locationId: LOC_A.id,
      onDate: "2026-10-09",
      countedPaise: 100000,
    });
  });
});
