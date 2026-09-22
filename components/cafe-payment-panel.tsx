"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { recordPaymentAction } from "@/lib/actions/payments";
import { formatINR } from "@/lib/money/format";
import {
  inputClass,
  METHOD_OPTIONS,
  REFERENCE_LABEL,
  type BillSummary,
  type PaymentMethod,
} from "@/components/cafe-order-shared";

// K-07/K-08 — bill settlement, the "Collect payment" step after the
// bill's amount due is visible. The amount sent is the amount due
// (café bills settle in full, K-04); the server's refusal — partial
// payment, duplicate reference — is surfaced verbatim. Cash has no
// reference; UPI / card / other require one before the button is
// live.

export function CafePaymentPanel({
  bill,
  onPaid,
}: {
  bill: BillSummary;
  onPaid: (method: PaymentMethod) => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const referenceMissing = method !== "cash" && reference.trim().length === 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await recordPaymentAction({
        invoiceId: bill.invoiceId,
        amountPaise: bill.amountDuePaise,
        method,
        ...(method === "cash" ? {} : { reference: reference.trim() }),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onPaid(method);
    } catch {
      setError("The payment could not be recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

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

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-warn-soft px-3 py-2 text-[13px] text-ink"
          data-testid="cafe-payment-error"
        >
          {error}
        </p>
      ) : null}

      <div>
        <p className="block text-[12px] font-medium text-ink-2 mb-2">
          Payment method
        </p>
        <div className="grid grid-cols-2 gap-2">
          {METHOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={method === option.value}
              onClick={() => {
                setMethod(option.value);
                setReference("");
              }}
              className={`min-h-[44px] rounded-ctl border px-3 py-2 text-left ${
                method === option.value
                  ? "border-[var(--accent-strong)] bg-paper"
                  : "border-line bg-paper"
              }`}
            >
              <span className="block text-[13px] font-medium text-ink">
                {option.label}
              </span>
              <span className="block text-[11px] text-ink-3">
                {option.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      {method !== "cash" ? (
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            {REFERENCE_LABEL[method]}
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className={inputClass}
            data-testid="cafe-reference"
          />
        </label>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={submit}
        disabled={busy || referenceMissing}
      >
        {busy ? "Recording…" : "Record payment"}
      </Button>
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
