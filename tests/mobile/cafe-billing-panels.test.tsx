// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PaymentIntentRecovery } from "@/lib/services/payment-intent-recovery";

vi.stubGlobal("crypto", { randomUUID });

// K-08 — reception café billing panels render tests.
//   * the open-order list shows member, status, bill number and amount
//     due, and an honest empty state when nothing is open;
//   * Request bill → itemized bill with the amount due visible before
//     Collect payment;
//   * a walk-in cannot be billed: the server's reason is shown and no
//     anonymous path is offered;
//   * a server refusal is surfaced verbatim.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const requestCafeBillAction = vi.hoisted(() => vi.fn());
const recordPaymentAction = vi.hoisted(() => vi.fn());
const listPaymentRecoveryAction = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<PaymentIntentRecovery>>(async () => ({
    open: null,
    lastCommitted: null,
  })),
);
const cancelPaymentRecoveryAction = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, intentId: "intent-1", replayed: false })),
);

vi.mock("@/lib/actions/orders", () => ({ requestCafeBillAction }));
vi.mock("@/lib/actions/payments", () => ({ recordPaymentAction }));
vi.mock("@/lib/actions/payment-intents", () => ({
  listPaymentRecoveryAction,
  cancelPaymentRecoveryAction,
}));

vi.mock("@/lib/actions/payment-qrs", () => ({
  listPaymentQrsAction: vi.fn(async () => []),
}));

import { CafeOpenOrders } from "@/components/cafe-open-orders";
import { CafeBillPanel } from "@/components/cafe-bill-panel";
import type { CafeBill, OpenCafeOrderRow } from "@/lib/services/cafe-billing";

const LOCATION = "11111111-1111-7111-8111-111111111111";

const MEMBER_ORDER: OpenCafeOrderRow = {
  orderId: "o1",
  status: "placed",
  memberId: "m1",
  memberName: "Aadhya Sharma",
  locationId: LOCATION,
  locationName: "Worli",
  createdAt: "2026-09-18T06:00:00.000Z",
  totalPaise: 26250,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 26250,
  billable: true,
};

const WALK_IN_ORDER: OpenCafeOrderRow = {
  orderId: "o2",
  status: "served",
  memberId: null,
  memberName: null,
  locationId: LOCATION,
  locationName: "Worli",
  createdAt: "2026-09-18T06:05:00.000Z",
  totalPaise: 10500,
  invoiceId: null,
  invoiceNumber: null,
  amountDuePaise: 10500,
  billable: false,
};

const BILL: CafeBill = {
  orderId: "o1",
  status: "billed",
  memberId: "m1",
  memberName: "Aadhya Sharma",
  locationId: LOCATION,
  locationName: "Worli",
  documentKind: "tax_invoice",
  invoiceId: "inv1",
  invoiceNumber: "INV-2026-0001",
  invoiceStatus: "issued",
  lines: [
    {
      itemName: "Masala chai",
      qty: 1,
      unitPricePaise: 25000,
      linePaise: 25000,
      taxRateBp: 500,
      taxPaise: 1250,
    },
  ],
  subtotalPaise: 25000,
  taxPaise: 1250,
  totalPaise: 26250,
  amountDuePaise: 26250,
};

beforeEach(() => {
  requestCafeBillAction.mockResolvedValue({
    ok: true,
    alreadyBilled: false,
    bill: BILL,
  });
  recordPaymentAction.mockResolvedValue({
    ok: true,
    id: "pay1",
    invoiceStatus: "paid",
  });
  listPaymentRecoveryAction.mockResolvedValue({
    open: null,
    lastCommitted: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CafeOpenOrders — listing", () => {
  it("renders an honest empty state when nothing is open", () => {
    render(<CafeOpenOrders orders={[]} />);
    expect(screen.getByText("No open café orders")).toBeTruthy();
  });

  it("lists the member, status and amount due for each open order", () => {
    render(<CafeOpenOrders orders={[MEMBER_ORDER, WALK_IN_ORDER]} />);
    expect(screen.getByTestId("cafe-open-order-o1").textContent).toContain(
      "Aadhya Sharma",
    );
    expect(screen.getByTestId("cafe-open-order-o1").textContent).toContain(
      "Placed",
    );
    expect(
      screen.getByTestId("cafe-open-order-o1").getAttribute("data-amount-due"),
    ).toBe("26250");
    expect(screen.getByTestId("cafe-open-order-o2").textContent).toContain(
      "Walk-in",
    );
  });

  it("shows the walk-in reason and offers no bill action for it", () => {
    render(<CafeOpenOrders orders={[WALK_IN_ORDER]} />);
    expect(
      screen.getByTestId("cafe-open-walk-in-o2").textContent,
    ).toMatch(/walk-in order needs a member before it can be billed/i);
    expect(
      screen.queryByRole("button", { name: /request bill for walk-in/i }),
    ).toBeNull();
  });
});

describe("CafeOpenOrders — request bill then collect", () => {
  it("requests the bill and shows the itemized amount due before payment", async () => {
    render(<CafeOpenOrders orders={[MEMBER_ORDER]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for aadhya sharma/i }),
    );

    await screen.findByTestId("cafe-bill");
    expect(requestCafeBillAction).toHaveBeenCalledWith({ orderId: "o1" });

    const due = screen.getByTestId("cafe-amount-due");
    expect(due.getAttribute("data-amount-paise")).toBe("26250");
    expect(due.textContent).toContain("262.50");
    expect(screen.getByTestId("cafe-bill-lines").textContent).toContain(
      "Masala chai",
    );
    expect(screen.getByTestId("cafe-bill-subtotal").textContent).toContain(
      "250.00",
    );
    expect(screen.getByTestId("cafe-bill-tax").textContent).toContain("12.50");

    await waitFor(() =>
      expect(
        (screen.getByRole("button", {
          name: /record payment/i,
        }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("cafe-receipt");
    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv1",
      amountPaise: 26250,
      method: "cash",
      // F01 — the public action carries a one-time operation key, so a
      // slow café payment cannot settle the bill twice.
      idempotencyKey: expect.any(String),
      observedIntentId: null,
    });
  });

  it("surfaces a server refusal verbatim and stays on the list", async () => {
    requestCafeBillAction.mockResolvedValue({
      ok: false,
      error: "Order not found.",
    });
    render(<CafeOpenOrders orders={[MEMBER_ORDER]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for aadhya sharma/i }),
    );

    const alert = await screen.findByTestId("cafe-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Order not found.");
    expect(screen.queryByTestId("cafe-bill")).toBeNull();
  });
});

describe("CafeBillPanel", () => {
  it("blocks a new payment and explains an ambiguous payment record", async () => {
    listPaymentRecoveryAction.mockResolvedValue({
      open: null,
      lastCommitted: null,
      ambiguous: true,
    });
    render(<CafeBillPanel bill={BILL} onPaid={vi.fn()} />);

    const notice = await screen.findByTestId("payment-recovery-ambiguous");
    expect(notice.textContent).toMatch(/earlier payment records for this bill conflict/i);
    expect(notice.textContent).toMatch(/manual resolution outside this screen/i);
    expect(notice.textContent).not.toMatch(/forked|cycled|administrator/i);

    const button = screen.getByRole("button", {
      name: /record payment/i,
    }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    expect(recordPaymentAction).not.toHaveBeenCalled();
  });

  it("confirms the paid result before a slow recovery read resolves", async () => {
    const onPaid = vi.fn();
    recordPaymentAction.mockResolvedValue({
      ok: true,
      id: "pay-1",
      invoiceStatus: "paid",
    });
    render(<CafeBillPanel bill={BILL} onPaid={onPaid} />);
    await waitFor(() => expect(listPaymentRecoveryAction).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /upi qr/i }));
    fireEvent.change(screen.getByTestId("cafe-reference"), {
      target: { value: "UTR-42" },
    });

    listPaymentRecoveryAction.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await waitFor(() => expect(onPaid).toHaveBeenCalledWith("upi", "inv1"));
  });

  it("clears the retained unknown outcome when the same panel serves a different bill", async () => {
    recordPaymentAction.mockRejectedValueOnce(new Error("Failed to fetch"));
    const { rerender } = render(
      <CafeBillPanel bill={BILL} onPaid={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /upi qr/i }));
    fireEvent.change(screen.getByTestId("cafe-reference"), {
      target: { value: "UTR-A" },
    });
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    expect(await screen.findByText(/did not complete/i)).toBeTruthy();
    expect(screen.getByText(/outcome is unknown/i)).toBeTruthy();

    const otherBill: CafeBill = {
      ...BILL,
      invoiceId: "inv-b",
      invoiceNumber: "INV-B",
      amountDuePaise: 10000,
    };
    rerender(<CafeBillPanel bill={otherBill} onPaid={() => {}} />);

    await waitFor(() =>
      expect(screen.queryByText(/outcome is unknown/i)).toBeNull(),
    );
    const show = await screen.findByRole("button", { name: /show upi qr/i });
    expect((show as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not mark a different bill paid when the previous bill's payment resolves late", async () => {
    const billA = { ...BILL, invoiceId: "inv-a", invoiceNumber: "INV-A" };
    const billB = { ...BILL, invoiceId: "inv-b", invoiceNumber: "INV-B" };
    const orderTwo = {
      ...MEMBER_ORDER,
      orderId: "o2",
      memberId: "m2",
      memberName: "Second Member",
      invoiceNumber: "INV-B",
    };
    requestCafeBillAction.mockImplementation(
      async (input: { orderId: string }) => ({
        ok: true,
        alreadyBilled: false,
        bill: input.orderId === "o1" ? billA : billB,
      }),
    );
    let resolvePayment: ((value: unknown) => void) | undefined;
    recordPaymentAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePayment = resolve;
      }),
    );

    render(<CafeOpenOrders orders={[MEMBER_ORDER, orderTwo]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for aadhya sharma/i }),
    );
    await screen.findByTestId("cafe-bill");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    // The operator leaves the first bill while its payment is still in
    // flight and collects a different bill.
    fireEvent.click(screen.getByRole("button", { name: /back to open orders/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for second member/i }),
    );
    await screen.findByTestId("cafe-bill");

    resolvePayment!({ ok: true, id: "pay-a", invoiceStatus: "paid" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // The second bill was never paid: it must not show a receipt.
    expect(screen.queryByTestId("cafe-receipt")).toBeNull();
    expect(screen.getAllByText(/INV-B/).length).toBeGreaterThan(0);
  });

  it("does not carry a previous bill's refusal onto the next bill", async () => {
    const billA = { ...BILL, invoiceId: "inv-a", invoiceNumber: "INV-A" };
    const billB = { ...BILL, invoiceId: "inv-b", invoiceNumber: "INV-B" };
    const orderTwo = {
      ...MEMBER_ORDER,
      orderId: "o2",
      memberId: "m2",
      memberName: "Second Member",
      invoiceNumber: "INV-B",
    };
    requestCafeBillAction.mockImplementation(
      async (input: { orderId: string }) => ({
        ok: true,
        alreadyBilled: false,
        bill: input.orderId === "o1" ? billA : billB,
      }),
    );
    let resolvePayment: ((value: unknown) => void) | undefined;
    recordPaymentAction.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePayment = resolve;
      }),
    );

    render(<CafeOpenOrders orders={[MEMBER_ORDER, orderTwo]} />);
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for aadhya sharma/i }),
    );
    await screen.findByTestId("cafe-bill");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /record payment/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    fireEvent.click(screen.getByRole("button", { name: /back to open orders/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /request bill for second member/i }),
    );
    await screen.findByTestId("cafe-bill");

    resolvePayment!({ ok: false, error: "Server refusal." });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByText(/Server refusal/i)).toBeNull();
    expect(screen.getByRole("button", { name: /record payment/i })).toBeTruthy();
  });

  it("renders every line and the totals in paise", () => {
    render(<CafeBillPanel bill={BILL} onPaid={vi.fn()} />);
    expect(screen.getByTestId("cafe-bill").textContent).toContain(
      "INV-2026-0001",
    );
    expect(screen.getByTestId("cafe-bill-total").textContent).toContain(
      "262.50",
    );
    expect(screen.getByTestId("cafe-amount-due").textContent).toContain(
      "262.50",
    );
  });
});
