"use client";

import { CafePaymentPanel } from "@/components/cafe-payment-panel";
import { formatINR } from "@/lib/money/format";
import type { CafeBill } from "@/lib/services/cafe-billing";
import type { PaymentMethod } from "@/components/cafe-order-shared";

// K-08 — the itemized bill: the order's snapshotted lines, the
// subtotal/GST/total maths, and the amount due, all in integer paise
// (the server re-derived these; the panel only formats them). Below
// it sits the existing payment panel — the split the owner asked
// for: Request bill → amount visible → Collect payment.

export function CafeBillPanel({
  bill,
  onPaid,
}: {
  bill: CafeBill;
  onPaid: (method: PaymentMethod) => void;
}) {
  return (
    <section
      className="rounded-card border border-line bg-paper p-4 space-y-4"
      data-testid="cafe-bill"
      data-amount-due={bill.amountDuePaise}
    >
      <div>
        <p className="text-[12px] text-ink-3">
          Bill for {bill.memberName}
          {bill.documentKind === "bill_of_supply" ? " · Bill of Supply" : ""}
        </p>
        <p className="font-display text-[18px] font-semibold text-ink">
          {bill.invoiceNumber}
        </p>
      </div>

      <ul className="divide-y divide-line" data-testid="cafe-bill-lines">
        {bill.lines.map((line, index) => (
          <li
            key={`${line.itemName}-${index}`}
            className="flex items-start justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-[14px] text-ink">{line.itemName}</p>
              <p className="text-[12px] text-ink-3">
                {line.qty} × {formatINR(line.unitPricePaise)}
                {line.taxRateBp > 0
                  ? ` · GST ${(line.taxRateBp / 100).toFixed(
                      line.taxRateBp % 100 === 0 ? 0 : 2,
                    )}%`
                  : ""}
              </p>
            </div>
            <span className="text-[14px] font-medium text-ink">
              {formatINR(line.linePaise + line.taxPaise)}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-line pt-3 space-y-1">
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>Subtotal</span>
          <span data-testid="cafe-bill-subtotal">
            {formatINR(bill.subtotalPaise)}
          </span>
        </div>
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>GST</span>
          <span data-testid="cafe-bill-tax">{formatINR(bill.taxPaise)}</span>
        </div>
        <div className="flex justify-between text-[15px] font-semibold text-ink">
          <span>Total</span>
          <span data-testid="cafe-bill-total">
            {formatINR(bill.totalPaise)}
          </span>
        </div>
        <div
          className="flex justify-between text-[15px] font-semibold text-ink"
          data-testid="cafe-amount-due"
          data-amount-paise={bill.amountDuePaise}
        >
          <span>Amount due</span>
          <span>{formatINR(bill.amountDuePaise)}</span>
        </div>
      </div>

      <CafePaymentPanel bill={bill} onPaid={onPaid} />
    </section>
  );
}
