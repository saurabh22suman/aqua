// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// C05 (docs/audits/2026-10-09-role-content-permission-audit.md §9) —
// a closed cash count is a real state, not a recount prompt. The old
// UI said "Recount" and called confirmCashCount again, which the
// service correctly refuses as "already closed". This suite pins the
// closed badge + figures, the settings.manage-only Reopen with its
// required reason, the dynamic >₹500/>₹2,000 help, and the
// refresh-before-retry behaviour after an uncertain failure.

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

const CLOSED = report({
  cashCount: {
    countedPaise: 100000,
    systemPaise: 100000,
    variancePaise: 0,
    note: null,
    confirmedByName: "Owner",
    confirmedAt: "2026-10-09T14:30:00.000Z",
    needsReview: false,
  },
});

const REVIEW_PENDING = report({
  cashCount: {
    countedPaise: 940000,
    systemPaise: 1000000,
    variancePaise: -60000,
    note: "Short by 600",
    confirmedByName: "Owner",
    confirmedAt: "2026-10-09T14:30:00.000Z",
    needsReview: true,
  },
});

const LOCATIONS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Main" },
];

const BASE = {
  defaultDate: "2026-10-09",
  locations: LOCATIONS,
  facilityLabel: "Facility",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CollectionsReport closed count (C05)", () => {
  it("renders a closed count as Closed with no Recount or Confirm action", async () => {
    getDailyCollectionAction.mockResolvedValue(CLOSED);

    render(<CollectionsReport {...BASE} canConfirm canReopen={false} />);

    await screen.findByText("Closed");
    expect(
      screen.queryByRole("button", { name: /recount|confirm count/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /reopen/i })).toBeNull();
  });

  it("flags a closed count that still needs review", async () => {
    getDailyCollectionAction.mockResolvedValue(REVIEW_PENDING);

    render(<CollectionsReport {...BASE} canConfirm canReopen={false} />);

    await screen.findByText(/review pending/i);
  });

  it("reopens only for a settings.manage holder, with a required reason, then restores confirm", async () => {
    getDailyCollectionAction
      .mockResolvedValueOnce(CLOSED)
      .mockResolvedValue(report());
    reopenCashCountAction.mockResolvedValue({ ok: true });

    render(<CollectionsReport {...BASE} canConfirm canReopen />);

    await screen.findByText("Closed");
    fireEvent.click(screen.getByRole("button", { name: /reopen/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm reopen/i }));

    expect(reopenCashCountAction).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toMatch(/reason is required/i);

    fireEvent.change(screen.getByPlaceholderText(/reason/i), {
      target: { value: "Cash box miscount" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm reopen/i }));

    await waitFor(() =>
      expect(reopenCashCountAction).toHaveBeenCalledWith({
        locationId: LOCATIONS[0]!.id,
        onDate: "2026-10-09",
        reason: "Cash box miscount",
      }),
    );
    await screen.findByRole("button", { name: /confirm count/i });
  });

  it("refreshes the report before allowing a retry after an uncertain confirm failure", async () => {
    getDailyCollectionAction.mockResolvedValue(report());
    confirmCashCountAction.mockRejectedValue(new Error("Lost response"));

    render(<CollectionsReport {...BASE} canConfirm canReopen />);

    await screen.findByRole("button", { name: /confirm count/i });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm count/i }));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/refreshed/i),
    );
    expect(getDailyCollectionAction).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm count/i }).hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(confirmCashCountAction).toHaveBeenCalledTimes(1);
  });

  it("explains the >₹500 reason rule and the >₹2,000 owner rule while typing", async () => {
    getDailyCollectionAction.mockResolvedValue(report());

    render(<CollectionsReport {...BASE} canConfirm canReopen={false} />);

    await screen.findByRole("button", { name: /confirm count/i });
    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "1600" },
    });
    expect(document.body.textContent).toMatch(/over ₹500/i);
    expect(document.body.textContent).toMatch(/reason \(required\)/i);

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "3100" },
    });
    expect(document.body.textContent).toMatch(/over ₹2,000/i);
  });
});
