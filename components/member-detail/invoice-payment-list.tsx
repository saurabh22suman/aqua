"use client";

import { useState } from "react";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import type { PaymentReversalRow } from "@/lib/services/payment-reversals";
import type { PaymentRow } from "@/lib/services/payments";
import { InvoiceReversalForm } from "@/components/member-detail/invoice-reversal-form";
import type { InvoiceReloadResult } from "@/components/member-detail/invoice-closed-recovery";

function methodLabel(method: PaymentRow["method"]): string {
  if (method === "cash") return "Cash";
  if (method === "upi") return "UPI";
  return "Bank transfer";
}

export function InvoicePaymentList({
  payments,
  reversals,
  canRefund,
  busy,
  setBusy,
  onReload,
  onChanged,
  onMessage,
}: {
  payments: PaymentRow[];
  reversals: Record<string, PaymentReversalRow[]>;
  canRefund: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onReload: () => Promise<InvoiceReloadResult>;
  onChanged: () => void;
  onMessage: (message: string | null) => void;
}) {
  const [openReversalId, setOpenReversalId] = useState<string | null>(null);

  if (payments.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {payments.map((payment) => {
        const paymentReversals = reversals[payment.id] ?? [];
        const reversedPaise = paymentReversals.reduce(
          (sum, row) => sum + row.amountPaise,
          0,
        );
        const remainingPaise = payment.amountPaise - reversedPaise;
        return (
          <li
            key={payment.id}
            className="rounded-ctl border border-line px-2 py-1.5 text-[12px]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-ink">
                {formatINR(payment.amountPaise)} · {methodLabel(payment.method)}
                <span className="ml-2 text-ink-3">
                  {formatDateIST(payment.receivedAt)}
                  {payment.reference ? ` · ${payment.reference}` : ""}
                  {payment.receivedByName ? ` · ${payment.receivedByName}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <a
                  href={`/api/receipts/${payment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-2 text-[11px] text-ink-2 hover:text-ink"
                >
                  Receipt
                </a>
                {canRefund && remainingPaise > 0 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setOpenReversalId((current) =>
                        current === payment.id ? null : payment.id,
                      )
                    }
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-2 text-[11px] text-ink-2 hover:text-ink"
                  >
                    Reverse
                  </button>
                ) : null}
              </span>
            </div>

            {reversedPaise > 0 ? (
              <p className="mt-0.5 text-[11.5px] text-ink-3">
                {formatINR(reversedPaise)} reversed
              </p>
            ) : null}
            {paymentReversals.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {paymentReversals.map((row) => (
                  <li key={row.id} className="text-[11.5px] text-ink-3">
                    −{formatINR(row.amountPaise)} · {row.reason} ·{" "}
                    {formatDateIST(row.reversedAt)}
                  </li>
                ))}
              </ul>
            ) : null}

            {canRefund && openReversalId === payment.id ? (
              <InvoiceReversalForm
                key={payment.id}
                payment={payment}
                remainingPaise={remainingPaise}
                busy={busy}
                setBusy={setBusy}
                onReload={onReload}
                onChanged={onChanged}
                onMessage={onMessage}
                onClose={() => setOpenReversalId(null)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
