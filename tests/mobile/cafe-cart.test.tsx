// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CafeCart } from "@/components/cafe-cart";
import type { MenuItemRow } from "@/lib/services/menu-core";

// PR1-C4 — the counter cart must quote what the issued bill will
// say. An unregistered tenant cannot collect GST, so the cart shows
// no tax and the total equals the order/invoice total to the paisa.

const ITEM: MenuItemRow = {
  id: "item-1",
  locationId: "loc-1",
  categoryId: "cat-1",
  name: "Water bottle",
  pricePaise: 2000,
  taxRateBp: 500,
  sacCode: "996331",
  isVeg: true,
  isActive: true,
};

afterEach(cleanup);

describe("CafeCart GST parity (PR1-C4)", () => {
  it("shows no GST and the base total for an unregistered tenant", () => {
    render(
      <CafeCart
        lines={[{ item: ITEM, qty: 1 }]}
        placed={null}
        onQty={() => {}}
        taxRegistered={false}
      />,
    );
    const total = screen.getByTestId("cart-total");
    expect(total.getAttribute("data-total-paise")).toBe("2000");
    expect(document.body.textContent).toMatch(/GST₹0\.00/);
  });

  it("applies the menu rate for a registered tenant", () => {
    render(
      <CafeCart
        lines={[{ item: ITEM, qty: 1 }]}
        placed={null}
        onQty={() => {}}
        taxRegistered
      />,
    );
    const total = screen.getByTestId("cart-total");
    expect(total.getAttribute("data-total-paise")).toBe("2100");
    expect(document.body.textContent).toMatch(/GST₹1\.00/);
  });
});
