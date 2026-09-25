"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getInvoiceAction,
  voidInvoiceAction,
} from "@/lib/actions/invoices";
import {
  listInvoicePaymentsAction,
  recordPaymentAction,
} from "@/lib/actions/payments";
import {
  listPaymentReversalsAction,
  reversePaymentAction,
} from "@/lib/actions/payment-reversals";
import type { PaymentReversalRow } from "@/lib/services/payment-reversals";
import type { InvoiceDetail } from "@/lib/services/invoices";
import type { PaymentRow } from "@/lib/services/payments";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { gstDocumentLabel, placeOfSupplyForGstin } from "@/lib/gst";
import { formatDateIST } from "@/lib/time/tz";

// C-32/C-33/C-39 — one invoice, expanded: lines with the CGST/SGST
// split, recorded payments with receipt links, the record-payment
// form, and void before money arrives.

const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

function statusTone(status: InvoiceDetail["status"]): string {
  if (status === "paid") return "bg-marine/10 text-marine";
  if (status === "void") return "bg-deck text-ink-3 line-through";
  if (status === "partial") return "bg-deck text-ink-2";
  return "bg-deck text-ink-2";
}

function methodLabel(method: PaymentRow["method"]): string {
  if (method === "cash") return "Cash";
  if (method === "upi") return "UPI";
  return "Bank transfer";
}

export function InvoiceExpanded({
  invoiceId,
  canWrite,
  canRecord,
  canRefund,
  onChanged,
}: {
  invoiceId: string;
  canWrite: boolean;
  canRecord: boolean;
  canRefund: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentRow["method"]>("cash");
  const [reference, setReference] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  // PR2-C9 — reversals per payment, plus the open reverse form.
  const [reversals, setReversals] = useState<Record<string, PaymentReversalRow[]>>({});
  const [reverseFor, setReverseFor] = useState<string | null>(null);
  const [reverseAmount, setReverseAmount] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [invoice, pays] = await Promise.all([
        getInvoiceAction(invoiceId),
        listInvoicePaymentsAction(invoiceId),
      ]);
      setDetail(invoice);
      setPayments(pays);
      const reversalLists = await Promise.all(
        pays.map(async (payment) => [
          payment.id,
          await listPaymentReversalsAction(payment.id),
        ] as const),
      );
      setReversals(Object.fromEntries(reversalLists));
      setAmount(
        invoice && invoice.outstandingPaise > 0
          ? String(invoice.outstandingPaise / 100)
          : "",
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setMessage(null);
    void (async () => {
      const result = await fn();
      setMessage(result.ok ? "Saved." : result.error);
      if (result.ok) {
        await load();
        onChanged();
      }
      setBusy(false);
    })();
  }

  if (failed) {
    return (
      <p className="mt-2 text-[12px] text-ink-3">Could not load this invoice.</p>
    );
  }
  if (!detail) {
    return <p className="mt-2 text-[12px] text-ink-3">Loading invoice…</p>;
  }

  const placeOfSupply = placeOfSupplyForGstin(detail.gstin);
  const paymentAllowed =
    canRecord && (detail.status === "issued" || detail.status === "partial");

  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">
          {gstDocumentLabel(detail.documentKind)} · {detail.invoiceNumber}
        </span>
        <span
          className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${statusTone(detail.status)}`}
        >
          {detail.status}
        </span>
      </div>
      <p className="mt-0.5 text-[12px] text-ink-3">
        Issued {formatDateIST(detail.issuedOn)} · due {formatDateIST(detail.dueOn)}
        {detail.gstin ? ` · GSTIN ${detail.gstin}` : ""}
        {placeOfSupply ? ` · place of supply ${placeOfSupply}` : ""}
      </p>

      <table className="mt-2 w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
            <th className="py-1 font-medium">Description</th>
            <th className="py-1 font-medium">SAC</th>
            <th className="py-1 text-right font-medium">Amount</th>
            <th className="py-1 text-right font-medium">GST</th>
          </tr>
        </thead>
        <tbody>
          {detail.lines.map((line) => (
            <tr key={line.id} className="border-t border-line">
              <td className="py-1 pr-2 text-ink">{line.description}</td>
              <td className="py-1 pr-2 font-mono text-ink-3">{line.sacCode}</td>
              <td className="py-1 pr-2 text-right font-mono text-ink">
                {formatINR(line.amountPaise)}
              </td>
              <td className="py-1 text-right font-mono text-ink-2">
                {line.taxPaise === 0
                  ? "—"
                  : `CGST ${formatINR(line.cgstPaise)} + SGST ${formatINR(line.sgstPaise)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-1 text-right text-[12px] text-ink-2">
        Taxable {formatINR(detail.subtotalPaise)} + GST{" "}
        {formatINR(detail.taxPaise)} ={" "}
        <span className="font-semibold text-ink">
          {formatINR(detail.totalPaise)}
        </span>
      </p>
      <p className="text-right text-[12px] text-ink-3">
        Paid {formatINR(detail.paidPaise)} · outstanding{" "}
        {formatINR(detail.outstandingPaise)}
      </p>

      {payments.length > 0 ? (
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
                    {formatINR(payment.amountPaise)} ·{" "}
                    {methodLabel(payment.method)}
                    <span className="ml-2 text-ink-3">
                      {formatDateIST(payment.receivedAt)}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                      {payment.receivedByName
                        ? ` · ${payment.receivedByName}`
                        : ""}
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
                        onClick={() => {
                          setReverseFor(
                            reverseFor === payment.id ? null : payment.id,
                          );
                          setReverseAmount(String(remainingPaise / 100));
                          setReverseReason("");
                          setReverseError(null);
                        }}
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

                {canRefund && reverseFor === payment.id ? (
                  <div className="mt-1.5 rounded-ctl border border-line p-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-0.5 block text-[11px] text-ink-3">
                          Amount (₹)
                        </span>
                        <input
                          inputMode="decimal"
                          value={reverseAmount}
                          onChange={(e) => setReverseAmount(e.target.value)}
                          className={inputClass}
                          data-testid="reverse-amount"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-[11px] text-ink-3">
                          Reason
                        </span>
                        <input
                          value={reverseReason}
                          onChange={(e) => setReverseReason(e.target.value)}
                          className={inputClass}
                          data-testid="reverse-reason"
                        />
                      </label>
                    </div>
                    {reverseError ? (
                      <p role="alert" className="mt-1 text-[11.5px] text-ink-2">
                        {reverseError}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const paise = parseRupeesToPaise(reverseAmount);
                        if (paise === null || paise <= 0n) {
                          setReverseError("Enter an amount like 2500 or 2500.50.");
                          return;
                        }
                        if (reverseReason.trim().length < 3) {
                          setReverseError("Give a reason (3-300 characters).");
                          return;
                        }
                        setBusy(true);
                        setReverseError(null);
                        void (async () => {
                          const result = await reversePaymentAction({
                            paymentId: payment.id,
                            amountPaise: Number(paise),
                            reason: reverseReason.trim(),
                          });
                          if (!result.ok) {
                            setReverseError(result.error);
                          } else {
                            setReverseFor(null);
                            await load();
                            onChanged();
                          }
                          setBusy(false);
                        })();
                      }}
                      className="mt-1.5 rounded-pill px-3.5 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
                    >
                      Confirm reversal
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {paymentAllowed ? (
        <div className="mt-2 rounded-ctl border border-line p-2">
          <p className="text-[12px] font-medium text-ink-2">Record a payment</p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">
                Amount (₹)
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">Method</span>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentRow["method"])}
                className={inputClass}
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </label>
            {method !== "cash" ? (
              <label className="block">
                <span className="mb-0.5 block text-[11px] text-ink-3">
                  Reference (UTR)
                </span>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className={inputClass}
                  placeholder="UTR / transaction id"
                />
              </label>
            ) : null}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const paise = parseRupeesToPaise(amount);
              if (paise === null) {
                setMessage("Enter the amount in rupees, like 2500 or 2500.00.");
                return;
              }
              run(() =>
                recordPaymentAction({
                  invoiceId,
                  amountPaise: Number(paise),
                  method,
                  ...(method === "cash" ? {} : { reference: reference.trim() }),
                }),
              );
            }}
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-pill px-4 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Record payment"}
          </button>
        </div>
      ) : null}

      {canWrite && detail.status !== "void" && detail.paidPaise === 0 ? (
        <div className="mt-2">
          {showVoid ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Reason for voiding"
                className={`${inputClass} max-w-xs`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() => voidInvoiceAction({ invoiceId, reason: voidReason }))
                }
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-3 py-1 text-[12px] text-ink-2 hover:text-ink disabled:opacity-50"
              >
                Confirm void
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowVoid(true)}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-3 py-1 text-[12px] text-ink-3 hover:text-ink"
            >
              Void invoice
            </button>
          )}
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
