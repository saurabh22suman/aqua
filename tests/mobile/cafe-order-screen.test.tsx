// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// K-07/K-08 — reception café counter render tests.
//   * empty menu state
//   * menu grid grouped by category
//   * cart maths in integer paise (price × qty + per-line GST)
//   * bill-without-member disabled with the exact server limitation
//   * partial-payment refusal surfaced verbatim by the server
//   * the K-08 split: Request bill → itemized amount due → Collect
//     payment (the button no longer says "Bill & pay")

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

const createOrderAction = vi.hoisted(() => vi.fn());
const requestCafeBillAction = vi.hoisted(() => vi.fn());
const recordPaymentAction = vi.hoisted(() => vi.fn());
const listMembersAction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/orders", () => ({
  createOrderAction,
  requestCafeBillAction,
}));
vi.mock("@/lib/actions/payments", () => ({ recordPaymentAction }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction }));

import { CafeOrderScreen } from "@/components/cafe-order-screen";
import type { MemberListRow } from "@/lib/services/people";
import type { MenuCategoryRow, MenuItemRow } from "@/lib/services/menu";

const LOCATION = "11111111-1111-7111-8111-111111111111";

const CATEGORY: MenuCategoryRow = {
  id: "c1",
  locationId: LOCATION,
  name: "Beverages",
  sortOrder: 0,
  isActive: true,
};

const TEA: MenuItemRow = {
  id: "i1",
  locationId: LOCATION,
  categoryId: "c1",
  name: "Masala chai",
  pricePaise: 25000,
  taxRateBp: 500,
  sacCode: "996331",
  isVeg: true,
  isActive: true,
};

const SAMOSA: MenuItemRow = {
  id: "i2",
  locationId: LOCATION,
  categoryId: "c1",
  name: "Samosa",
  pricePaise: 40000,
  taxRateBp: 1200,
  sacCode: "996331",
  isVeg: true,
  isActive: true,
};

const MEMBER = {
  memberId: "m1",
  personId: "p1",
  fullName: "Aadhya Sharma",
  phone: null,
  memberCode: "AWS-010",
  status: "active",
  locationId: LOCATION,
  locationName: "Worli",
  isMinor: true,
  createdAt: "2026-09-01T06:00:00.000Z",
  joinedOn: "2026-09-01",
} as unknown as MemberListRow;

const LOCATIONS = [{ id: LOCATION, name: "Worli" }];
const TERMINOLOGY = { overrides: {}, locale: "en" } as const;

function renderScreen(
  categories: MenuCategoryRow[] = [CATEGORY],
  items: MenuItemRow[] = [TEA, SAMOSA],
) {
  return render(
    <CafeOrderScreen
      categories={categories}
      items={items}
      locations={LOCATIONS}
      terminology={TERMINOLOGY}
      taxRegistered
    />,
  );
}

async function chooseMember() {
  fireEvent.change(screen.getByTestId("cafe-member-search"), {
    target: { value: "Aadhya" },
  });
  fireEvent.click(screen.getByRole("button", { name: /search members/i }));
  fireEvent.click(await screen.findByTestId("cafe-member-option-m1"));
}

async function reachPaymentPhase() {
  fireEvent.click(screen.getByRole("button", { name: "Add Masala chai" }));
  await chooseMember();
  fireEvent.click(screen.getByRole("button", { name: /request bill/i }));
  await screen.findByTestId("cafe-payment");
}

beforeEach(() => {
  createOrderAction.mockResolvedValue({
    ok: true,
    orderId: "o1",
    totalPaise: 26250,
  });
  requestCafeBillAction.mockResolvedValue({
    ok: true,
    alreadyBilled: false,
    bill: {
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
    },
  });
  recordPaymentAction.mockResolvedValue({
    ok: true,
    id: "pay1",
    invoiceStatus: "paid",
  });
  listMembersAction.mockResolvedValue([MEMBER]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CafeOrderScreen — menu and cart", () => {
  it("shows an honest empty state when the menu has no active items", () => {
    renderScreen([], []);
    expect(screen.getByText("No menu items yet")).toBeTruthy();
    expect(
      screen.getByText(/owner sets up the café menu/i),
    ).toBeTruthy();
  });

  it("groups items under their category", () => {
    renderScreen();
    expect(screen.getByText("Beverages")).toBeTruthy();
    expect(screen.getByText("Masala chai")).toBeTruthy();
    expect(screen.getByText("Samosa")).toBeTruthy();
  });

  it("computes the cart total in paise (price × qty + GST per line)", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Add Masala chai" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase Masala chai" }));

    // 2 × ₹250.00 = 50000 paise base; 5% GST = 2500; total 52500.
    const total = screen.getByTestId("cart-total");
    expect(total.getAttribute("data-total-paise")).toBe("52500");
    expect(total.textContent).toContain("525.00");
    expect(screen.getByTestId("cafe-qty-i1").textContent).toBe("2");
  });

  it("places a walk-in order with the lines the cart holds", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Add Masala chai" }));
    fireEvent.click(screen.getByRole("button", { name: /place order/i }));

    await vi.waitFor(() =>
      expect(createOrderAction).toHaveBeenCalledWith({
        locationId: LOCATION,
        memberId: null,
        lines: [{ itemId: "i1", qty: 1 }],
      }),
    );
    expect(await screen.findByTestId("cafe-order-status")).toBeTruthy();
  });
});

describe("CafeOrderScreen — walk-in billing limitation", () => {
  it("disables Request bill and states the exact limitation when no member is chosen", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Add Masala chai" }));

    const bill = screen.getByRole("button", { name: /request bill/i });
    expect((bill as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cafe-walk-in-note").textContent).toMatch(
      /walk-in order needs a member before it can be billed/i,
    );
  });

  it("stays disabled after a walk-in order is placed and does not request the bill", async () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Add Masala chai" }));
    fireEvent.click(screen.getByRole("button", { name: /place order/i }));
    await screen.findByTestId("cafe-order-status");

    const bill = screen.getByRole("button", { name: /request bill/i });
    expect((bill as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(bill);
    expect(requestCafeBillAction).not.toHaveBeenCalled();
  });
});

describe("CafeOrderScreen — request bill and collect payment", () => {
  it("shows the itemized amount due before collecting the counter payment", async () => {
    renderScreen();
    await reachPaymentPhase();

    expect(createOrderAction).toHaveBeenCalledWith({
      locationId: LOCATION,
      memberId: "m1",
      lines: [{ itemId: "i1", qty: 1 }],
    });
    await vi.waitFor(() =>
      expect(requestCafeBillAction).toHaveBeenCalledWith({ orderId: "o1" }),
    );

    // K-08 split: amount visible first, payment second.
    const due = screen.getByTestId("cafe-amount-due");
    expect(due.getAttribute("data-amount-paise")).toBe("26250");
    expect(due.textContent).toContain("262.50");
    expect(screen.getByTestId("cafe-bill-lines").textContent).toContain(
      "Masala chai",
    );
    expect(screen.getByTestId("cafe-payment").textContent).toContain(
      "INV-2026-0001",
    );

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    await screen.findByTestId("cafe-receipt");
    expect(recordPaymentAction).toHaveBeenCalledWith({
      invoiceId: "inv1",
      amountPaise: 26250,
      method: "cash",
    });
    expect(screen.getByTestId("cafe-receipt").textContent).toContain(
      "INV-2026-0001",
    );
  });

  it("surfaces the server's partial-payment refusal verbatim", async () => {
    recordPaymentAction.mockResolvedValue({
      ok: false,
      error:
        "A café bill settles in full — the amount must equal the outstanding balance of ₹262.50.",
    });
    renderScreen();
    await reachPaymentPhase();

    fireEvent.click(screen.getByRole("button", { name: /record payment/i }));

    const alert = await screen.findByTestId("cafe-payment-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("A café bill settles in full");
    expect(screen.queryByTestId("cafe-receipt")).toBeNull();
  });
});
