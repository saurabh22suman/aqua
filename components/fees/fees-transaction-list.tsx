import { formatINR } from "@/lib/money/format";
import { formatDateTimeIST } from "@/lib/time/tz";
import { methodLabel } from "@/lib/services/payments";
import type { HubTransactionRow } from "@/lib/services/fees-hub";

// OpenPen owner reference — transactions are one ledger surface, identity
// first, with a divided row that reflows to a labelled card on a phone.
// Amounts keep their sign and tabular numerals; reversals carry their reason.

export function FeesTransactionList({
  rows,
  memberLabel,
  caption = "Transactions",
}: {
  rows: HubTransactionRow[];
  memberLabel: string;
  caption?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-[13px] text-ink-3">
        No counter payments in this period.
      </p>
    );
  }

  function amount(transaction: HubTransactionRow) {
    return (
      <span className={transaction.amountPaise < 0 ? "text-late" : "text-ink"}>
        {transaction.amountPaise < 0
          ? `−${formatINR(Math.abs(transaction.amountPaise))}`
          : formatINR(transaction.amountPaise)}
      </span>
    );
  }

  function method(transaction: HubTransactionRow) {
    if (transaction.kind === "reversal") {
      return (
        <>
          Reversal
          {transaction.reason ? (
            <span className="ml-1 text-ink-3">{transaction.reason}</span>
          ) : null}
        </>
      );
    }
    return (
      <>
        {methodLabel(transaction.method)}
        {transaction.reference ? (
          <span className="ml-1 text-ink-3">{transaction.reference}</span>
        ) : null}
      </>
    );
  }

  return (
    <section
      data-testid="fees-transaction-surface"
      className="mt-3 overflow-hidden rounded-card border border-line bg-paper"
    >
      <table
        role="table"
        className="block w-full border-collapse text-[13px] lg:table lg:table-fixed"
      >
        <caption className="sr-only">{caption}</caption>
        <colgroup className="hidden lg:table-column-group">
          <col style={{ width: "34%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead data-testid="fees-transaction-head" className="hidden lg:table-header-group">
          <tr className="border-b border-line text-[11px] uppercase tracking-[0.1em] text-ink-3">
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              {memberLabel}
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              Recorded
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-left font-medium">
              Method
            </th>
            <th scope="col" role="columnheader" className="px-3.5 py-2 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {rows.map((transaction) => (
            <tr
              key={transaction.id}
              data-testid="fees-transaction-row"
              role="row"
              className="block border-b border-line last:border-0 lg:table-row lg:border-0"
            >
              <td
                role="cell"
                className="block px-3.5 pt-3 lg:table-cell lg:border-b lg:border-line lg:py-3"
              >
                <p className="text-[14px] font-medium text-ink">
                  {transaction.memberName ?? "—"}
                </p>
                <p
                  className="mt-0.5 truncate font-mono text-[12px] text-ink-3"
                  title={`${transaction.invoiceNumber ?? "No invoice"} · ${transaction.locationName}`}
                >
                  {transaction.invoiceNumber ?? "No invoice"} ·{" "}
                  {transaction.locationName}
                </p>
              </td>
              <td
                role="cell"
                className="block px-3.5 pt-2 text-[12.5px] text-ink-2 tabular-nums lg:table-cell lg:border-b lg:border-line lg:py-3"
              >
                <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                  Recorded
                </span>
                {formatDateTimeIST(transaction.receivedAt)}
              </td>
              <td
                role="cell"
                className="block px-3.5 pt-2 text-[12.5px] text-ink-2 lg:table-cell lg:border-b lg:border-line lg:py-3"
              >
                <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                  Method
                </span>
                {method(transaction)}
              </td>
              <td
                role="cell"
                className="block px-3.5 py-3 text-[12.5px] font-medium tabular-nums lg:table-cell lg:border-b lg:border-line lg:text-right"
              >
                <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                  Amount
                </span>
                {amount(transaction)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
