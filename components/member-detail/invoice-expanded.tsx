"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getInvoiceAction, voidInvoiceAction } from "@/lib/actions/invoices";
import { listInvoicePaymentsAction } from "@/lib/actions/payments";
import { listPaymentReversalsAction } from "@/lib/actions/payment-reversals";
import type { PaymentReversalRow } from "@/lib/services/payment-reversals";
import type { InvoiceDetail } from "@/lib/services/invoices";
import type { PaymentRow } from "@/lib/services/payments";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { InvoiceSummary } from "@/components/member-detail/invoice-summary";
import { InvoicePaymentList } from "@/components/member-detail/invoice-payment-list";
import {
  InvoiceClosedRecovery,
  type InvoiceReloadResult,
} from "@/components/member-detail/invoice-closed-recovery";
import { InvoicePaymentForm } from "@/components/member-detail/invoice-payment-form";

// C-32/C-33/C-39 — one invoice, expanded: lines with the CGST/SGST
// split, recorded payments with receipt links, the record-payment form,
// and void before money arrives. Void is management authority
// (settings.manage — owner/admin, R01); other invoice writers see an
// ask-the-owner note instead.
//
// WR-1 / Option A — a walk-in invoice has no member, so the settled
// summary carries the PAYER's name and a null member id, and the
// "Open invoice" link (in the Dues parent) is skipped for it.

type RunResult =
  | {
      ok: true;
      id?: string;
      invoiceStatus?: InvoiceDetail["status"];
      replayed?: boolean;
    }
  | { ok: false; error: string; conflict?: string };

type SubmittedPayment = {
  amountPaise: number;
  method: PaymentRow["method"];
};

// MF-01 — what the Dues parent needs to keep the completed settlement
// visible after the live list re-fetch removes the now-paid invoice.
// It is a presentation snapshot of rows the parent is already allowed
// to render; no storage, read authority or financial write is added.
export type InvoiceSettledSummary = {
  invoiceId: string;
  invoiceNumber: string;
  // WR-1 — a guest invoice has no member.
  memberId: string | null;
  memberName: string | null;
  // The payer's display name: the member's name for a member payer,
  // the walk-in's own name for a guest payer.
  payerName: string;
  amountPaise: number;
  method: PaymentRow["method"];
  paymentId: string;
  // null when the post-commit invoice read failed and the current
  // balance was therefore not verified.
  outstandingPaise: number | null;
  // true only when the canonical post-operation reload says paid.
  confirmed: boolean;
};

export function InvoiceExpanded({
  invoiceId,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
  onChanged,
  onSettled,
}: {
  invoiceId: string;
  canWrite: boolean;
  canVoid?: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
  onChanged: () => void;
  /**
   * MF-01 — called after a successful recording leaves the invoice paid.
   * The Dues parent uses it only to retain the completion strip; other
   * consumers omit it and keep their existing behaviour.
   */
  onSettled?: (summary: InvoiceSettledSummary) => void;
}) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [reversals, setReversals] = useState<Record<string, PaymentReversalRow[]>>(
    {},
  );
  const activeInvoice = useRef(invoiceId);
  const loadSeq = useRef(0);
  // What the last successful load actually returned. `run` needs the
  // post-operation invoice/payment state to know whether the recording
  // settled the document, without trusting the caller's result alone.
  const latestLoad = useRef<{
    detail: InvoiceDetail;
    payments: PaymentRow[];
  } | null>(null);

  useEffect(() => {
    activeInvoice.current = invoiceId;
    latestLoad.current = null;
    setBusy(false);
    setMessage(null);
    setShowVoid(false);
    setVoidReason("");
  }, [invoiceId]);

  const load = useCallback(async (): Promise<InvoiceReloadResult> => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    const target = invoiceId;
    try {
      const [invoice, pays] = await Promise.all([
        getInvoiceAction(invoiceId),
        listInvoicePaymentsAction(invoiceId),
      ]);
      if (seq !== loadSeq.current || activeInvoice.current !== target) {
        return "superseded";
      }
      setDetail(invoice);
      setPayments(pays);
      latestLoad.current = invoice ? { detail: invoice, payments: pays } : null;
      if (canReadPayments) {
        const reversalLists = await Promise.all(
          pays.map(async (payment) => [
            payment.id,
            await listPaymentReversalsAction(payment.id),
          ] as const),
        );
        if (seq !== loadSeq.current || activeInvoice.current !== target) {
          return "superseded";
        }
        setReversals(Object.fromEntries(reversalLists));
      } else {
        setReversals({});
      }
      setFailed(false);
      return "ok";
    } catch {
      if (seq === loadSeq.current && activeInvoice.current === target) {
        setFailed(true);
      }
      return "failed";
    }
  }, [invoiceId, canReadPayments]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(
    fn: () => Promise<RunResult>,
    onResult?: (result: RunResult) => Promise<string | void> | string | void,
    submitted?: SubmittedPayment,
  ) {
    const runInvoice = invoiceId;
    const before = latestLoad.current;
    const capturedBefore = payments
      .filter((payment) => payment.status === "captured")
      .reduce((sum, payment) => sum + payment.amountPaise, 0);
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await fn();
        if (activeInvoice.current !== runInvoice) return;
        const override = await onResult?.(result);
        if (activeInvoice.current !== runInvoice) return;
        setMessage(
          typeof override === "string"
            ? override
            : result.ok
              ? "Saved."
              : result.error,
        );
        if (result.ok) {
          const reload = await load();
          if (activeInvoice.current !== runInvoice) return;
          // MF-01 — the reload above is the canonical post-operation
          // state. Only a paid document that gained captured money is a
          // verified settlement; a void, a reversal or a plain refresh
          // keeps the existing row/notice behaviour.
          const loaded = latestLoad.current;
          let settled: InvoiceSettledSummary | null = null;
          if (loaded && loaded.detail.status === "paid") {
            const captured = loaded.payments.filter(
              (payment) => payment.status === "captured",
            );
            const capturedAfter = captured.reduce(
              (sum, payment) => sum + payment.amountPaise,
              0,
            );
            if (capturedAfter > capturedBefore) {
              const recorded = result.id
                ? captured.find((payment) => payment.id === result.id)
                : undefined;
              const payment = recorded ?? captured[0];
              if (payment) {
                settled = {
                  invoiceId: loaded.detail.id,
                  invoiceNumber: loaded.detail.invoiceNumber,
                  memberId: loaded.detail.memberId,
                  memberName: loaded.detail.memberName,
                  payerName: loaded.detail.payerName,
                  amountPaise: payment.amountPaise,
                  method: payment.method,
                  paymentId: payment.id,
                  outstandingPaise: loaded.detail.outstandingPaise,
                  confirmed: true,
                };
              }
            }
          }
          // B1 — the action already committed and returned its exact
          // submitted amount/method plus id and current status; only the
          // follow-up read failed. State the known saved outcome without
          // claiming a freshly verified balance.
          const savedId = result.id;
          if (
            !settled &&
            reload === "failed" &&
            result.invoiceStatus === "paid" &&
            savedId &&
            submitted &&
            before
          ) {
            settled = {
              invoiceId: before.detail.id,
              invoiceNumber: before.detail.invoiceNumber,
              memberId: before.detail.memberId,
              memberName: before.detail.memberName,
              payerName: before.detail.payerName,
              amountPaise: submitted.amountPaise,
              method: submitted.method,
              paymentId: savedId,
              outstandingPaise: null,
              confirmed: false,
            };
          }
          if (settled) onSettled?.(settled);
          onChanged();
        }
      } catch {
        if (activeInvoice.current !== runInvoice) return;
        await onResult?.({ ok: false, error: "request_failed", conflict: "unknown" });
        await load();
        if (activeInvoice.current !== runInvoice) return;
        setMessage(
          "The request did not complete. The invoice was refreshed — check it before retrying, in case the change already went through.",
        );
      } finally {
        if (activeInvoice.current === runInvoice) setBusy(false);
      }
    })();
  }

  if (failed) {
    return (
      <div className="mt-2">
        {message ? (
          <p
            role="status"
            className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12px] text-ink"
          >
            {message}
          </p>
        ) : null}
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

  const paymentAllowed =
    canRecord && (detail.status === "issued" || detail.status === "partial");
  // A closed target is the only place the discard-only recovery block
  // belongs. An open invoice uses the normal Continue/New notice; a viewer
  // without payments.record cannot discard anything, so the block is
  // hidden rather than offering an action the server will deny.
  const closedTarget = detail.status === "paid" || detail.status === "void";
  // Only a CAPTURED payment moves the invoice's paid figure, so the
  // comparison uses the captured rows alone: a visible pending or failed
  // row must not manufacture the note.
  const capturedTotalPaise = payments
    .filter((payment) => payment.status === "captured")
    .reduce((sum, payment) => sum + payment.amountPaise, 0);

  return (
    <div className="mt-2 border-t border-line pt-2">
      <InvoiceSummary
        detail={detail}
        capturedTotalPaise={capturedTotalPaise}
        canReadPayments={canReadPayments}
      />

      <InvoicePaymentList
        payments={payments}
        reversals={reversals}
        canRefund={canRefund}
        busy={busy}
        setBusy={setBusy}
        onReload={load}
        onChanged={onChanged}
        onMessage={setMessage}
      />

      {closedTarget ? (
        <InvoiceClosedRecovery
          invoiceId={invoiceId}
          canRecord={canRecord}
          onReload={load}
          onMessage={setMessage}
        />
      ) : null}

      {paymentAllowed ? (
        <InvoicePaymentForm
          invoiceId={invoiceId}
          invoiceNumber={detail.invoiceNumber}
          outstandingPaise={detail.outstandingPaise}
          busy={busy}
          setMessage={setMessage}
          run={run}
        />
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
