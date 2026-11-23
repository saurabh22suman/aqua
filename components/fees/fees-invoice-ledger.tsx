"use client";

import { Fragment, type RefObject } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import { formatINR } from "@/lib/money/format";
import { COLLECTION_HOLD_COPY } from "@/lib/collection-hold";
import { formatDateIST, todayInZone } from "@/lib/time/tz";
import { InvoiceExpanded, type InvoiceSettledSummary } from "@/components/member-detail/invoice-expanded";
import { METHOD_LABEL } from "@/lib/money/payment-groups";
import { Button } from "@/components/ui/Button";
import { StatusBadge, TONE_SURFACE_CLASS, type StatusTone } from "@/components/ui/StatusBadge";

// Invoice lifecycle → a readable word and a status tone. `issued` and
// `partial` mean money is still owed (the needs-attention tone),
// `paid` means settled, `draft` and `void` carry no urgency.
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

export function FeesSettledResult({ settled, facility, settledHeadingRef, onDismiss }: {
  settled: InvoiceSettledSummary | null; facility?: string | null;
  settledHeadingRef: RefObject<HTMLParagraphElement | null>; onDismiss: () => void;
}) {
  return settled ? (
      <section
        data-testid="dues-settled-result"
        role="status"
        className={`mt-3 rounded-card border border-line px-3.5 py-3 ${
          settled.confirmed ? TONE_SURFACE_CLASS.good : "bg-deck"
        }`}
      >
        <p
          ref={settledHeadingRef}
          tabIndex={-1}
          className="text-[13px] font-medium text-ink"
        >
          {settled.confirmed
            ? "Payment recorded — invoice settled"
            : "Payment recorded"}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-2" data-testid="dues-settled-detail">
          {formatINR(settled.amountPaise)} by{" "}
          {METHOD_LABEL[settled.method] ?? settled.method} for{" "}
          {settled.invoiceNumber} · {settled.payerName || "guest"}.{" "}
          {settled.confirmed
            ? settled.outstandingPaise !== null && settled.outstandingPaise > 0
              ? `Balance ${formatINR(settled.outstandingPaise)}.`
              : "Nothing outstanding."
            : "The invoice could not be re-read after saving — check it before recording another payment."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            href={`/api/receipts/${settled.paymentId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
          >
            View receipt
          </a>
          {settled.memberId ? (
            <Link
              href={`/owner/members/${settled.memberId}?tab=payments&facility=${encodeURIComponent(facility ?? "all")}`}
              className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
            >
              Open invoice
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-3 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      </section>
    ) : null;

}

export function FeesInvoiceLedger({ rows, facility, filter, caption, expandedId, canWrite, canVoid, canRecord, canRefund, canReadPayments, onToggle, onSettled, onChanged }: {
  rows: HubInvoiceRow[]; facility?: string | null; filter: "dues" | "all"; caption: string;
  expandedId: string | null; canWrite: boolean; canVoid: boolean; canRecord: boolean;
  canRefund: boolean; canReadPayments: boolean; onToggle: (id: string) => void;
  onSettled: (summary: InvoiceSettledSummary) => void; onChanged: () => void;
}) {
  // The academy's day, not the server's UTC day (staging blocker F15).
  // Between 00:00 and 05:29 IST the UTC date is still yesterday, so a
  // UTC-derived "today" hides an invoice that is already overdue.
  const today = todayInZone("Asia/Kolkata");

  function isOverdue(invoice: HubInvoiceRow): boolean {
    // A void document can never be collected — the invoice service
    // refuses it — so it is never labelled overdue. The stored balance
    // and the document's own totals stay exactly as they are; only the
    // collectible wording goes.
    if (invoice.status === "void") return false;
    return invoice.outstandingPaise > 0 && invoice.dueOn < today;
  }

  /**
   * What the row says about the money it still shows. A void document
   * keeps its stored balance, but that balance can never be collected,
   * so the row does not call it outstanding.
   */
  function balanceCaption(invoice: HubInvoiceRow): string {
    if (invoice.outstandingPaise <= 0) return "Nothing outstanding";
    if (invoice.status === "void") return "Balance on a void document";
    return "Balance outstanding";
  }

  return (
      <section
        data-testid="invoice-ledger-surface"
        className="mt-3 rounded-card border border-line bg-[var(--surface-featured)]"
      >
      <table
        role="table"
        className="block w-full border-collapse text-[13px] lg:table lg:table-auto"
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup className="hidden lg:table-column-group">
          <col style={{ width: "32%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "10%" }} />
        </colgroup>
        <thead data-testid="invoice-ledger-head" className="hidden lg:table-header-group">
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.1em] text-ink-3">
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              Member / invoice
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              Due
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-right font-medium">
              Invoice total
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-right font-medium">
              Balance
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              State
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-right font-medium">
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody data-testid="invoice-ledger" className="block lg:table-row-group">
          {rows.map((invoice) => (
            <Fragment key={invoice.id}>
              <tr
                data-testid="invoice-ledger-row"
                role="row"
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-line px-3.5 py-3 last:border-0 lg:table-row lg:border-0 lg:px-0 lg:py-0"
              >
                <td
                  role="cell"
                  className="order-1 min-w-0 block lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3"
                >
                  {invoice.memberId ? (
                    <Link
                      href={`/owner/members/${invoice.memberId}?facility=${encodeURIComponent(facility ?? "all")}`}
                      className="break-words [overflow-wrap:anywhere] text-[14px] font-medium text-ink"
                    >
                      {invoice.payerName}
                    </Link>
                  ) : (
                    <span className="break-words [overflow-wrap:anywhere] text-[14px] font-medium text-ink">
                      {invoice.payerName}
                    </span>
                  )}
                  <p
                    className="mt-0.5 hidden break-words [overflow-wrap:anywhere] font-mono text-[12px] text-ink-3 lg:block"
                    title={`${invoice.invoiceNumber} · ${invoice.locationName}`}
                  >
                    {invoice.invoiceNumber} · {invoice.locationName}
                  </p>
                </td>
                <td
                  role="cell"
                  className="order-3 flex flex-wrap items-center gap-x-2 gap-y-1 lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3"
                >
                  <span
                    data-testid="invoice-due"
                    className="block text-[12.5px] text-ink-2 tabular-nums"
                  >
                    <span className="lg:hidden">Due </span>{formatDateIST(invoice.dueOn)}
                  </span>
                  {isOverdue(invoice) ? (
                    <span className="inline-flex lg:mt-1">
                      <StatusBadge tone="late">Overdue</StatusBadge>
                    </span>
                  ) : null}
                </td>
                <td
                  role="cell"
                  className="order-5 min-w-0 self-center text-[12.5px] text-ink-2 tabular-nums lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <span className="block break-words [overflow-wrap:anywhere] text-[12px] text-ink-3 lg:hidden">{invoice.invoiceNumber} · {invoice.locationName}</span>
                  <span className="lg:hidden">Total </span><span className="whitespace-nowrap">{formatINR(invoice.totalPaise)}</span>
                </td>
                <td
                  role="cell"
                  className="order-2 block whitespace-nowrap text-right text-[14px] font-medium text-ink tabular-nums lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                    {filter === "dues" ? "Outstanding" : "Balance"}
                  </span>
                  {formatINR(invoice.outstandingPaise)}
                </td>
                <td
                  role="cell"
                  className="order-4 block text-right lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-left"
                >
                  <span data-testid="invoice-status">
                    <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                      {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                    </StatusBadge>
                  </span>
                  {invoice.collectionHold && invoice.outstandingPaise > 0 && invoice.status !== "void" ? (
                    <p className="mt-1 text-[12px] font-medium leading-snug text-ink-2">
                      {COLLECTION_HOLD_COPY[invoice.collectionHold].label}
                    </p>
                  ) : null}
                </td>
                <td
                  role="cell"
                  className="order-6 block self-center lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <div className="flex items-center justify-end gap-2">
                    {filter === "all" ? <span className="text-[12px] text-ink-3 lg:hidden">
                      {balanceCaption(invoice)}
                    </span> : null}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onToggle(invoice.id)}
                      aria-expanded={expandedId === invoice.id}
                      aria-label={`${expandedId === invoice.id ? "Hide" : "Open"} invoice ${invoice.invoiceNumber} for ${invoice.payerName || "payer unavailable"}`}
                    >
                      {expandedId === invoice.id ? "Hide" : "Open"}
                    </Button>
                  </div>
                </td>
              </tr>
              {expandedId === invoice.id ? (
                <tr role="row" className="block lg:table-row">
                  <td
                    role="cell"
                    colSpan={6}
                    className="block border-b border-line bg-deck/30 px-3.5 py-3 lg:table-cell"
                  >
                    <InvoiceExpanded
                      invoiceId={invoice.id}
                      canWrite={canWrite}
                      canVoid={canVoid}
                      canRecord={canRecord}
                      canRefund={canRefund}
                      canReadPayments={canReadPayments}
                      onSettled={
                        filter === "dues"
                          ? onSettled
                          : undefined
                      }
                      onChanged={onChanged}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
