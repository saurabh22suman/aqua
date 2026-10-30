"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { listHubInvoicesAction } from "@/lib/actions/fees-hub";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, todayInZone } from "@/lib/time/tz";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import { Button } from "@/components/ui/Button";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";

// U-02 — the dues and invoice lists. Dues are collectible in place
// (the existing InvoiceExpanded carries the record-payment form);
// the full invoice list uses the same rows without inviting a
// payment on a settled document. One client island per list, no
// page-level JavaScript.
//
// Owner-UI review P1 (2026-10-13) — the reload used to drop the
// facility scope the server rendered with, so recording a payment
// silently widened the list to every facility. The scope is now
// part of the request and of the rendered state: rows are only
// shown when they belong to the current scope, and an older
// response cannot replace a newer one (request sequence).

type RowsState = { scope: string; rows: HubInvoiceRow[] };

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

export function FeesInvoiceList({
  initial,
  filter,
  facility,
  canWrite,
  canVoid = false,
  canRecord,
  canRefund,
  canReadPayments,
  caption = "Invoice ledger",
}: {
  initial: HubInvoiceRow[];
  filter: "dues" | "all";
  // The validated facility scope the server rendered with. null/absent
  // means "every facility the caller may see".
  facility?: string | null;
  canWrite: boolean;
  canVoid?: boolean;
  canRecord: boolean;
  canRefund: boolean;
  canReadPayments: boolean;
  // Accessible table caption; the surrounding page owns the visible heading.
  caption?: string;
}) {
  const router = useRouter();
  const scope = `${filter}|${facility ?? ""}`;
  const [data, setData] = useState<RowsState | null>(() => ({
    scope,
    rows: initial,
  }));
  const [loadError, setLoadError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const loadedScope = useRef(scope);

  const load = useCallback(async () => {
    const requestScope = `${filter}|${facility ?? ""}`;
    const seq = ++requestSeq.current;
    setLoadError(false);
    try {
      const next = await listHubInvoicesAction({
        status: filter,
        ...(facility ? { locationId: facility } : {}),
      });
      // A slower response for an earlier scope must not replace the
      // current one; the next load() (new scope or explicit reload)
      // bumps the sequence. The render also refuses rows whose scope
      // no longer matches the heading.
      if (seq !== requestSeq.current) return;
      setData({ scope: requestScope, rows: next });
    } catch {
      if (seq === requestSeq.current) setLoadError(true);
    }
  }, [filter, facility]);

  useEffect(() => {
    // The server already rendered this scope's rows. Only fetch when
    // the scope changed after mount, or on the explicit reload path.
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      void load();
    }
  }, [scope, load]);

  const rows = data && data.scope === scope ? data.rows : null;

  if (loadError) {
    return (
      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[13px] text-ink-3">
          Could not load this list — the figures above may be stale.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (rows === null) {
    return <p className="mt-4 text-[13px] text-ink-3">Loading…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-[13px] text-ink-3">
        {filter === "dues"
          ? "Nothing outstanding — every issued invoice is settled."
          : "No invoices yet. Raise one from a member's page or the member's active plan."}
      </p>
    );
  }

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

  function toggle(id: string) {
    setExpandedId(expandedId === id ? null : id);
  }

  return (
    <section
      data-testid="invoice-ledger-surface"
      className="mt-3 overflow-hidden rounded-card border border-line bg-paper"
    >
      <table
        role="table"
        className="block w-full border-collapse text-[13px] lg:table lg:table-fixed"
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
                className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-line px-3.5 py-3 last:border-0 lg:table-row lg:border-0 lg:px-0 lg:py-0"
              >
                <td
                  role="cell"
                  className="col-span-2 block lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3"
                >
                  <Link
                    href={`/owner/members/${invoice.memberId}`}
                    className="text-[14px] font-medium text-ink"
                  >
                    {invoice.memberName}
                  </Link>
                  <p
                    className="mt-0.5 truncate font-mono text-[12px] text-ink-3"
                    title={`${invoice.invoiceNumber} · ${invoice.locationName}`}
                  >
                    {invoice.invoiceNumber} · {invoice.locationName}
                  </p>
                </td>
                <td
                  role="cell"
                  className="block lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3"
                >
                  <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                    Due
                  </span>
                  <span
                    data-testid="invoice-due"
                    className="block text-[12.5px] text-ink-2 tabular-nums"
                  >
                    {formatDateIST(invoice.dueOn)}
                  </span>
                  {isOverdue(invoice) ? (
                    <span className="mt-1 inline-flex">
                      <StatusBadge tone="late">Overdue</StatusBadge>
                    </span>
                  ) : null}
                </td>
                <td
                  role="cell"
                  className="block text-[12.5px] text-ink-2 tabular-nums lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                    Invoice total
                  </span>
                  {formatINR(invoice.totalPaise)}
                </td>
                <td
                  role="cell"
                  className="block text-[12.5px] font-medium text-ink tabular-nums lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <span className="block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                    Balance
                  </span>
                  {invoice.outstandingPaise > 0
                    ? formatINR(invoice.outstandingPaise)
                    : "₹0"}
                </td>
                <td
                  role="cell"
                  className="block lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3"
                >
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-ink-3 lg:hidden">
                    State
                  </span>
                  <span data-testid="invoice-status">
                    <StatusBadge tone={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>
                      {INVOICE_STATUS_LABEL[invoice.status] ?? invoice.status}
                    </StatusBadge>
                  </span>
                </td>
                <td
                  role="cell"
                  className="col-span-2 block lg:table-cell lg:border-b lg:border-line lg:px-3.5 lg:py-3 lg:text-right"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-ink-3 lg:hidden">
                      {balanceCaption(invoice)}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toggle(invoice.id)}
                      aria-expanded={expandedId === invoice.id}
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
                      onChanged={() => {
                        void load();
                        router.refresh();
                      }}
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
