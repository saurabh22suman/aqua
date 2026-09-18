"use client";

import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CafePaymentPanel } from "@/components/cafe-payment-panel";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";
import {
  METHOD_OPTIONS,
  type PaymentMethod,
} from "@/components/cafe-order-shared";
import type { BookingBill } from "@/lib/services/booking-billing";

// V-04 — the booking bill: the facility/time header, the single
// invoice line, the subtotal/GST/total maths (all integer paise,
// re-derived on the server) and the amount due. Below it sits the
// same payment panel the café uses — Request bill → amount visible →
// Collect — so the counter has one settlement flow, not two.
//
// The booking price is GST-inclusive: the total here is exactly the
// price quoted at booking time, to the paisa.

export function BookingBillPanel({
  bill,
  onPaid,
  onBack,
}: {
  bill: BookingBill;
  onPaid: (method: PaymentMethod) => void;
  onBack: () => void;
}) {
  return (
    <section
      className="rounded-card border border-line bg-paper p-4 space-y-4"
      data-testid="booking-bill"
      data-amount-due={bill.amountDuePaise}
    >
      <div>
        <p className="text-[12px] text-ink-3">
          Bill for {bill.memberName || "member"}
          {bill.documentKind === "bill_of_supply" ? " · Bill of Supply" : ""}
        </p>
        <p className="font-display text-[18px] font-semibold text-ink">
          {bill.invoiceNumber}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          {bill.facilityName}
          {bill.subUnitName ? ` · ${bill.subUnitName}` : ""}
        </p>
        <p className="text-[12px] text-ink-3">
          {formatDateIST(bill.startsAt)} · {formatTimeIST(bill.startsAt)}–
          {formatTimeIST(bill.endsAt)}
        </p>
      </div>

      <ul className="divide-y divide-line" data-testid="booking-bill-lines">
        <li className="flex items-start justify-between gap-3 py-2">
          <span className="min-w-0 text-[14px] text-ink">
            {bill.lineDescription}
          </span>
          <span className="text-[14px] font-medium text-ink">
            {formatINR(bill.subtotalPaise + bill.taxPaise)}
          </span>
        </li>
      </ul>

      <div className="border-t border-line pt-3 space-y-1">
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>Subtotal</span>
          <span data-testid="booking-bill-subtotal">
            {formatINR(bill.subtotalPaise)}
          </span>
        </div>
        <div className="flex justify-between text-[13px] text-ink-2">
          <span>GST</span>
          <span data-testid="booking-bill-tax">{formatINR(bill.taxPaise)}</span>
        </div>
        <div className="flex justify-between text-[15px] font-semibold text-ink">
          <span>Total</span>
          <span data-testid="booking-bill-total">
            {formatINR(bill.totalPaise)}
          </span>
        </div>
        <div
          className="flex justify-between text-[15px] font-semibold text-ink"
          data-testid="booking-amount-due"
          data-amount-paise={bill.amountDuePaise}
        >
          <span>Amount due</span>
          <span>{formatINR(bill.amountDuePaise)}</span>
        </div>
      </div>

      {bill.amountDuePaise > 0 ? (
        <CafePaymentPanel bill={bill} onPaid={onPaid} />
      ) : (
        <p className="rounded-ctl bg-good-soft px-3 py-2 text-[13px] text-ink">
          This bill is settled in full.
        </p>
      )}

      <Button variant="ghost" size="sm" className="w-full" onClick={onBack}>
        Back to the board
      </Button>
    </section>
  );
}

export function BookingReceipt({
  bill,
  method,
  onReset,
}: {
  bill: BookingBill;
  method: PaymentMethod;
  onReset: () => void;
}) {
  const methodLabel =
    METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method;
  return (
    <section
      className="rounded-card border border-line bg-paper p-5"
      data-testid="booking-receipt"
    >
      <div className="flex items-center gap-2 text-good">
        <Receipt size={18} strokeWidth={2} />
        <p className="text-[14px] font-semibold">Paid</p>
      </div>
      <p className="mt-2 font-display text-[20px] font-semibold text-ink">
        {bill.invoiceNumber}
      </p>
      <p className="mt-1 text-[13px] text-ink-2">
        {formatINR(bill.totalPaise)} · {methodLabel}
      </p>
      <Button
        variant="secondary"
        size="md"
        className="mt-4 w-full"
        onClick={onReset}
      >
        New booking
      </Button>
    </section>
  );
}
