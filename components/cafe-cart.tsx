"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/money/format";
import {
  cartTotals,
  lineTotal,
  type CartLine,
  type PlacedOrder,
} from "@/components/cafe-order-shared";

// K-07 — the counter cart. Steppers are 44px targets (Button sm);
// totals are the same integer-paise sum the order service computes.
// Once an order is placed the lines lock: there is no service to
// edit a placed order, so the UI must not imply one.

export function CafeCart({
  lines,
  placed,
  onQty,
  taxRegistered,
}: {
  lines: CartLine[];
  placed: PlacedOrder | null;
  onQty: (itemId: string, delta: number) => void;
  taxRegistered: boolean;
}) {
  const totals = cartTotals(lines, taxRegistered);
  const locked = placed !== null;

  return (
    <section
      className="rounded-card border border-line bg-paper p-4"
      data-testid="cafe-cart"
    >
      <h2 className="font-display text-[15px] font-semibold text-ink">Cart</h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          Tap Add on a menu item to start the order.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-line">
          {lines.map(({ item, qty }) => {
            const computed = lineTotal(item, qty, taxRegistered);
            return (
              <div key={item.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-ink">{item.name}</p>
                  <p className="text-[12px] text-ink-3">
                    {formatINR(item.pricePaise)} × {qty}
                  </p>
                </div>
                <span className="text-[14px] font-medium text-ink">
                  {formatINR(computed.base + computed.tax)}
                </span>
                {!locked ? (
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onQty(item.id, -1)}
                      aria-label={`Decrease ${item.name}`}
                    >
                      <Minus size={16} strokeWidth={2} />
                    </Button>
                    <span
                      className="w-6 text-center text-[14px] text-ink"
                      data-testid={`cafe-qty-${item.id}`}
                    >
                      {qty}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onQty(item.id, 1)}
                      aria-label={`Increase ${item.name}`}
                    >
                      <Plus size={16} strokeWidth={2} />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3 space-y-1">
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>Subtotal</span>
          <span>{formatINR(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>GST</span>
          <span>{formatINR(totals.tax)}</span>
        </div>
        <div
          className="flex justify-between text-[15px] font-semibold text-ink"
          data-testid="cart-total"
          data-total-paise={totals.total}
        >
          <span>Total</span>
          <span>{formatINR(totals.total)}</span>
        </div>
        {!taxRegistered ? (
          <p className="text-[11px] text-ink-3">
            Bill of supply — no GSTIN on file, so no GST is charged.
          </p>
        ) : null}
      </div>

      {placed ? (
        <p
          className="mt-3 text-[12px] text-ink-2"
          data-testid="cafe-order-status"
        >
          Order recorded — {formatINR(placed.totalPaise)}.
        </p>
      ) : null}
    </section>
  );
}
