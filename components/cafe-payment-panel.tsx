"use client";

import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/money/format";
import {
  METHOD_OPTIONS,
  type BillSummary,
  type PaymentMethod,
} from "@/components/cafe-order-shared";
import { CafePaymentRecoveryForm } from "@/components/cafe-payment-recovery-form";

// K-07/K-08 — bill settlement, the "Collect payment" step after the
// bill's amount due is visible. The amount sent is the amount due
// (café bills settle in full, K-04); the server's refusal — partial
// payment, duplicate reference — is surfaced verbatim. Cash has no
// reference; UPI / card / other require one before the button is live.

export function CafePaymentPanel({
  bill,
  onPaid,
}: {
  bill: BillSummary;
  onPaid: (method: PaymentMethod, billId?: string) => void;
}) {
  return (
    <section
      className="rounded-card border border-line bg-paper p-4 space-y-4"
      data-testid="cafe-payment"
    >
      <div>
        <p className="text-[12px] text-ink-3">Collect payment</p>
        <p className="font-display text-[18px] font-semibold text-ink">
          {bill.invoiceNumber}
        </p>
        <p className="mt-1 text-[13px] text-ink-2">
          Amount due {formatINR(bill.amountDuePaise)}
        </p>
      </div>

      <CafePaymentRecoveryForm bill={bill} onPaid={onPaid} />
    </section>
  );
}

export function CafeReceipt({
  bill,
  method,
  onReset,
}: {
  bill: BillSummary;
  method: PaymentMethod;
  onReset: () => void;
}) {
  const methodLabel =
    METHOD_OPTIONS.find((option) => option.value === method)?.label ?? method;
  return (
    <section
      className="rounded-card border border-line bg-paper p-5"
      data-testid="cafe-receipt"
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
        Start a new order
      </Button>
    </section>
  );
}
