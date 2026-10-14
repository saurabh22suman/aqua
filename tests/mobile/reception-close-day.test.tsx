// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Review remediation — a refresh failure after a committed close must
// not read as a save failure. The old catch wrapped the post-close
// onChanged() call, so a flaky refresh showed "Couldn't save the
// count... retry" and invited a duplicate close. The refresh now runs
// outside the save try (same shape as collections-report.tsx); only a
// genuine save throw keeps the check-before-retry copy.

const confirmCashCountAction = vi.hoisted(() => vi.fn());
const getReceptionCloseSummaryAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/reconciliation", () => ({
  confirmCashCountAction,
  getReceptionCloseSummaryAction,
}));

import { ReceptionCloseDay } from "@/components/reception-close-day";
import type { ReceptionCloseSummary } from "@/lib/services/reconciliation-closed-state";

const SUMMARY: ReceptionCloseSummary = {
  onDate: "2026-10-10",
  locations: [
    {
      locationId: "11111111-1111-4111-8111-111111111111",
      locationName: "Main",
      paymentCount: 2,
      totalPaise: 150000,
      cashPaise: 100000,
      upiPaise: 50000,
      bankTransferPaise: 0,
      methods: [],
      closed: false,
      cashCount: null,
    },
  ],
};

function renderClose() {
  render(
    <ReceptionCloseDay
      summary={SUMMARY}
      reviewThresholdPaise={50_000}
      ownerCloseThresholdPaise={200_000}
    />,
  );
}

async function confirmCount() {
  fireEvent.change(screen.getByPlaceholderText("0.00"), {
    target: { value: "1000" },
  });
  fireEvent.click(screen.getByRole("button", { name: /confirm cash count/i }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReceptionCloseDay committed-close refresh", () => {
  it("keeps the success message when the post-close refresh fails", async () => {
    confirmCashCountAction.mockResolvedValue({ ok: true, variancePaise: 0 });
    getReceptionCloseSummaryAction.mockRejectedValue(new Error("offline"));

    renderClose();
    await confirmCount();

    await screen.findByText(/closed — counted cash matched/i);
    expect(document.body.textContent).not.toMatch(/couldn't save the count/i);
    expect(getReceptionCloseSummaryAction).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: /confirm cash count/i,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it("keeps the check-before-retry copy for a genuine save failure", async () => {
    confirmCashCountAction.mockRejectedValue(new Error("network"));

    renderClose();
    await confirmCount();

    await screen.findByText(/couldn't save the count/i);
    expect(document.body.textContent).toMatch(/check whether the day closed/i);
    expect(getReceptionCloseSummaryAction).not.toHaveBeenCalled();
  });
});
