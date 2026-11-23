import { formatINR } from "@/lib/money/format";
import { gstDocumentLabel, placeOfSupplyForGstin } from "@/lib/gst";
import { formatDateIST } from "@/lib/time/tz";
import type { InvoiceDetail } from "@/lib/services/invoices";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { BillingIssuerDetails } from "@/components/billing-issuer-details";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";

// Owner redesign (C2) — the invoice state is a readable word in the
// shared status pill, not the raw database value in a hand-rolled chip.
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

export function InvoiceSummary({
  detail,
  capturedTotalPaise,
  canReadPayments,
  standalone = false,
}: {
  detail: InvoiceDetail;
  capturedTotalPaise: number;
  canReadPayments: boolean;
  /** The standalone owner route reads the balance first; every inline
   *  consumer keeps the original compact document layout. */
  standalone?: boolean;
}) {
  const placeOfSupply = placeOfSupplyForGstin(detail.gstin);
  const showAdjustmentNote =
    !canReadPayments && capturedTotalPaise > detail.paidPaise;
  const documentLines = (
    <>
      <BillingIssuerDetails issuer={detail.issuer} />
      {standalone && detail.lines.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">No line items are available for this invoice.</p>
      ) : <table className="mt-2 w-full text-[12px] [overflow-wrap:anywhere]">
        {standalone ? <caption className="sr-only">Charges on invoice {detail.invoiceNumber}</caption> : null}
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
            <th scope="col" className="py-1 pr-2 font-medium">Description</th>
            <th scope="col" className="py-1 pr-2 font-medium">SAC</th>
            <th scope="col" className="py-1 pr-2 text-right font-medium">Amount</th>
            <th scope="col" className="py-1 text-right font-medium">GST</th>
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
      </table>}
      <p className="mt-1 text-right text-[12px] text-ink-2">
        Taxable {formatINR(detail.subtotalPaise)} + GST {formatINR(detail.taxPaise)}
        {!standalone ? (
          <>
            {" = "}
            <span className="font-semibold text-ink">{formatINR(detail.totalPaise)}</span>
          </>
        ) : null}
      </p>
    </>
  );

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-ink-2">
          {gstDocumentLabel(detail.documentKind)}
          {standalone ? "" : ` · ${detail.invoiceNumber}`}
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
      {standalone ? (
        <dl className="my-3 grid grid-cols-2 gap-x-3 gap-y-2 owner-money-kpi px-3.5 py-3 text-[12px] sm:grid-cols-3">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <dt className="text-ink-3">
              {detail.status === "void" ? "Balance on a void document" : "Outstanding"}
            </dt>
            <dd className="mt-0.5 owner-money-value leading-tight text-ink [overflow-wrap:anywhere]">
              {formatINR(detail.outstandingPaise)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">Paid</dt>
            <dd className="mt-0.5 text-[16px] font-medium leading-tight tabular-nums text-ink [overflow-wrap:anywhere]">
              {formatINR(detail.paidPaise)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-ink-3">Total</dt>
            <dd className="mt-0.5 text-[16px] font-medium leading-tight tabular-nums text-ink [overflow-wrap:anywhere]">
              {formatINR(detail.totalPaise)}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-0.5 text-[12px] text-ink-3">
        Issued {formatDateIST(detail.issuedOn)} · due {formatDateIST(detail.dueOn)}
        {detail.gstin ? ` · GSTIN ${detail.gstin}` : ""}
        {placeOfSupply ? ` · place of supply ${placeOfSupply}` : ""}
      </p>
      {standalone ? (
        <details className="group mt-3 rounded-ctl border border-line bg-paper">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold text-ink">
            Line items and tax
            <OwnerIcon name="down" size={17} className="group-open:rotate-180" />
          </summary>
          <div className="border-t border-line p-3">{documentLines}</div>
        </details>
      ) : documentLines}
      {!standalone ? (
        <p className="text-right text-[12px] text-ink-3">
          Paid {formatINR(detail.paidPaise)} · outstanding {formatINR(detail.outstandingPaise)}
        </p>
      ) : null}

      {/* F-01 — the disclosure a role that cannot read reversals needs.
          It is derived ONLY from what this role can already read (the
          payment list it was shown and the invoice's own totals), so it
          grants nothing new: the payment rows sum to more than the
          invoice's paid figure when a later adjustment reduced it. The
          adjustment's amount, reason and actor stay unreadable — the
          note says the gap exists, not what caused it. */}
      {showAdjustmentNote ? (
        <p className="mt-1 text-[12px] text-ink-3">
          Recorded payments total {formatINR(capturedTotalPaise)}, but this
          invoice counts {formatINR(detail.paidPaise)} as paid. The difference
          is an adjustment applied after the payment; its details are not
          visible to your role.
        </p>
      ) : null}
    </>
  );
}
