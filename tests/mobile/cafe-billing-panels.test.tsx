// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/actions/orders", () => ({ requestCafeBillAction }));
vi.mock("@/lib/actions/payments", () => ({ recordPaymentAction }));

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

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));
    await screen.findByTestId("cafe-receipt");
    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv1",
      amountPaise: 26250,
      method: "cash",
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
