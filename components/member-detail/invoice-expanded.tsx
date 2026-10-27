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
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

// C-32/C-33/C-39 — one invoice, expanded: lines with the CGST/SGST
// split, recorded payments with receipt links, the record-payment
// form, and void before money arrives. Void is management authority
// (settings.manage — owner/admin, R01); other invoice writers see an
// ask-the-owner note instead.

// Owner redesign (C2) — the invoice state is a readable word in the
// shared status pill, not the raw database value in a hand-rolled chip.
// The tone map lives here; the token strings stay in the shared
// primitive.
const INVOICE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partial: "Partially paid",
  paid: "Paid",
  void: "Void",
};

const INVOICE_STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  issued: "warn",
  partial: "warn",
  paid: "good",
  void: "neutral",
};

function methodLabel(method: PaymentRow["method"]): string {
  if (method === "cash") return "Cash";
  if (method === "upi") return "UPI";
  return "Bank transfer";
}

export function InvoiceExpanded({
  invoiceId,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
  onChanged,
}: {
  invoiceId: string;
  canWrite: boolean;
  canVoid?: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
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
      if (canReadPayments) {
        const reversalLists = await Promise.all(
          pays.map(async (payment) => [
            payment.id,
            await listPaymentReversalsAction(payment.id),
          ] as const),
        );
        setReversals(Object.fromEntries(reversalLists));
      } else {
        setReversals({});
      }
      setAmount(
        invoice && invoice.outstandingPaise > 0
          ? String(invoice.outstandingPaise / 100)
          : "",
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [invoiceId, canReadPayments]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await fn();
        setMessage(result.ok ? "Saved." : result.error);
        if (result.ok) {
          await load();
          onChanged();
        }
      } catch {
        try {
          await load();
        } catch {
          // load() already switched the panel to its failed state
        }
        setMessage(
          "The request did not complete. The invoice was refreshed — check it before retrying, in case the change already went through.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }

  if (failed) {
    return (
      <div className="mt-2">
        <p className="text-[12px] text-ink-3">Could not load this invoice.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-1.5 inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
        >
          Retry
        </button>
      </div>
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
        <span data-testid="invoice-expanded-status">
          <StatusBadge
            tone={INVOICE_STATUS_TONE[detail.status] ?? "neutral"}
            className={detail.status === "void" ? "line-through" : ""}
          >
            {INVOICE_STATUS_LABEL[detail.status] ?? detail.status}
          </StatusBadge>
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field id="invoice-reverse-amount" label="Amount (₹)">
                        {(field) => (
                          <Input
                            {...field}
                            inputMode="decimal"
                            value={reverseAmount}
                            onChange={(e) => setReverseAmount(e.target.value)}
                            data-testid="reverse-amount"
                          />
                        )}
                      </Field>
                      <Field id="invoice-reverse-reason" label="Reason">
                        {(field) => (
                          <Input
                            {...field}
                            value={reverseReason}
                            onChange={(e) => setReverseReason(e.target.value)}
                            data-testid="reverse-reason"
                          />
                        )}
                      </Field>
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
                          try {
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
                          } catch {
                            try {
                              await load();
                            } catch {
                              // load() already switched the panel to its failed state
                            }
                            setReverseError(
                              "The request did not complete. The payment was refreshed — check it before retrying, in case the reversal already went through.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                      className="mt-1.5 inline-flex min-h-11 items-center justify-center rounded-pill px-3.5 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
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
        <div className="mt-2 rounded-ctl border border-line p-3">
          <p className="text-[12px] font-medium text-ink-2">Record a payment</p>
          {/* Owner redesign (C2) — the shared labelled controls, so the
              collection decision uses the same metrics and association
              as the rest of the owner surface. The invoice context
              (total, paid, outstanding) stays directly above it. */}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field id="invoice-payment-amount" label="Amount (₹)">
              {(field) => (
                <Input
                  {...field}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <Field id="invoice-payment-method" label="Method">
              {(field) => (
                <Select
                  {...field}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentRow["method"])}
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank_transfer">Bank transfer</option>
                </Select>
              )}
            </Field>
            {method !== "cash" ? (
              <Field id="invoice-payment-reference" label="Reference (UTR)">
                {(field) => (
                  <Input
                    {...field}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="UTR / transaction id"
                  />
                )}
              </Field>
            ) : null}
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
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
            className="mt-3"
          >
            {busy ? "Saving…" : "Record payment"}
          </Button>
        </div>
      ) : null}

      {canVoid && detail.status !== "void" && detail.paidPaise === 0 ? (
        <div className="mt-2">
          {showVoid ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Reason for voiding"
                aria-label="Reason for voiding"
                className="max-w-xs"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(() => voidInvoiceAction({ invoiceId, reason: voidReason }))
                }
              >
                Confirm void
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowVoid(true)}
            >
              Void invoice
            </Button>
          )}
        </div>
      ) : canWrite && detail.status !== "void" && detail.paidPaise === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">
          Ask the owner to cancel an invoice.
        </p>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
