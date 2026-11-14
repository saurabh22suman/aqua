"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { listHubInvoicesAction } from "@/lib/actions/fees-hub";
import type { HubInvoiceRow } from "@/lib/services/fees-hub";
import { formatINR } from "@/lib/money/format";
import { formatDateIST, todayInZone } from "@/lib/time/tz";
import { InvoiceExpanded } from "@/components/member-detail/invoice-expanded";
import type { InvoiceSettledSummary } from "@/components/member-detail/invoice-expanded";
import { METHOD_LABEL } from "@/lib/money/payment-groups";
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
//
// WR-1 / Option A — a walk-in bill has no member, so the row shows
// the PAYER's name and links to no member page: there is none. The
// row still opens the document (InvoiceExpanded reads the invoice
// itself), so a walk-in bill is as collectable and as visible as a
// member's.

type RowsState = { scope: string; rows: HubInvoiceRow[] };
type RememberedDues = { token:string; namespace:string; scope:string; search:string; status:"" | "issued" | "partial" };
// Search text stays in memory, not URLs or browser storage. The history
// entry holds only an opaque token and cannot restore another account's scope.
let rememberedDues: RememberedDues | null = null;

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
  initialInvoiceId,
  navigationNamespace,
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
  initialInvoiceId?: string;
  navigationNamespace?: string;
}) {
  const router = useRouter();
  const scope = `${filter}|${facility ?? ""}`;
  const [data, setData] = useState<RowsState | null>(() => ({
    scope,
    rows: initial,
  }));
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState<"" | "issued" | "partial">("");
  const [expandedId, setExpandedId] = useState<string | null>(() => initial.some((invoice) => invoice.id === initialInvoiceId) ? initialInvoiceId! : null);
  const lastTarget = useRef(initialInvoiceId);
  useEffect(() => {
    if (lastTarget.current === initialInvoiceId) return;
    lastTarget.current = initialInvoiceId;
    setExpandedId(initialInvoiceId && initial.some((invoice) => invoice.id === initialInvoiceId) ? initialInvoiceId : null);
  }, [initialInvoiceId, initial]);
  // MF-01 — the last full settlement in THIS Dues scope. It is a
  // presentation snapshot from rows the operator already saw; no
  // storage, extra read or financial change is introduced.
  const [settled, setSettled] = useState<InvoiceSettledSummary | null>(null);
  const settledHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const requestSeq = useRef(0);
  const loadedScope = useRef(scope);
  const restoredToken = useRef<string | null>(null);

  const load = useCallback(async (nextSearch = appliedSearch, nextStatus = invoiceStatus) => {
    const requestScope = `${filter}|${facility ?? ""}`;
    const seq = ++requestSeq.current;
    setLoadError(false);
    try {
      const next = await listHubInvoicesAction({
        status: filter,
        ...(facility ? { locationId: facility } : {}),
        ...(nextSearch ? { search: nextSearch } : {}),
        ...(nextStatus ? { invoiceStatus: nextStatus } : {}),
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
  }, [filter, facility, appliedSearch, invoiceStatus]);

  useEffect(() => {
    if (filter !== "dues" || !navigationNamespace || !rememberedDues) return;
    const token = window.history.state?.aquaDuesSearchToken;
    if (typeof token !== "string" || token === restoredToken.current || token !== rememberedDues.token || rememberedDues.namespace !== navigationNamespace || rememberedDues.scope !== scope) return;
    restoredToken.current = token;
    setSearch(rememberedDues.search);
    setAppliedSearch(rememberedDues.search);
    setInvoiceStatus(rememberedDues.status);
    void load(rememberedDues.search, rememberedDues.status);
  }, [filter, navigationNamespace, scope, load]);

  function remember(searchValue:string, statusValue:"" | "issued" | "partial") {
    if (!navigationNamespace) return;
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    rememberedDues = {token,namespace:navigationNamespace,scope,search:searchValue,status:statusValue};
    window.history.replaceState({...window.history.state,aquaDuesSearchToken:token}, "");
    restoredToken.current = token;
  }

  useEffect(() => {
    // The server already rendered this scope's rows. Only fetch when
    // the scope changed after mount, or on the explicit reload path.
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      void load();
    }
  }, [scope, load]);

  const rows = data && data.scope === scope ? data.rows : null;

  // A completion belongs to the Dues/facility scope that produced it.
  useEffect(() => {
    setSettled(null);
  }, [scope]);

  // O4 — the focused control inside the settled row disappears with it.
  // Move focus to the retained result so keyboard/screen-reader operators
  // are not dropped back to <body> exactly when the outcome appears.
  useEffect(() => {
    if (settled) settledHeadingRef.current?.focus();
  }, [settled]);

  const settledResult =
    filter === "dues" && settled ? (
      <section
        data-testid="dues-settled-result"
        role="status"
        className={`mt-3 rounded-card border border-line px-3.5 py-3 ${
          settled.confirmed ? "bg-good-soft" : "bg-deck"
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
              href={`/owner/members/${settled.memberId}?tab=payments`}
              className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
            >
              Open invoice
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setSettled(null)}
            className="inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-3 hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      </section>
    ) : null;

  const lookup = filter === "dues" ? (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      const value = search.trim();
      setAppliedSearch(value);
      remember(value, invoiceStatus);
      void load(value, invoiceStatus);
    }}>
      <label className="min-w-0 flex-1 text-[13px] text-ink-2">
        Search member, phone or invoice
        <input type="search" value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)} className="mt-1 min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-ink" />
      </label>
      <label className="text-[13px] text-ink-2">
        Status
        <select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value as "" | "issued" | "partial")} className="mt-1 block min-h-11 rounded-ctl border border-line bg-paper px-3 text-ink">
          <option value="">All due</option><option value="issued">Issued</option><option value="partial">Partially paid</option>
        </select>
      </label>
      <Button type="submit" variant="secondary">Search</Button>
      {(search || appliedSearch || invoiceStatus) ? <Button type="button" variant="secondary" onClick={() => { setSearch(""); setAppliedSearch(""); setInvoiceStatus(""); rememberedDues = null; void load("", ""); }}>Clear</Button> : null}
    </form>
  ) : null;

  if (loadError) {
    return (
      <>
        {settledResult}
        {lookup}
        <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
          <p className="text-[13px] text-ink-3">
            Could not load this list — the figures above may be stale.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2 hover:text-ink"
          >
            Retry
          </button>
        </div>
      </>
    );
  }

  if (rows === null) {
    return (
      <>
        {settledResult}
        {lookup}
        <p className="mt-4 text-[13px] text-ink-3">Loading…</p>
      </>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        {settledResult}
        {lookup}
        <p className="mt-4 text-[13px] text-ink-3">
          {appliedSearch || invoiceStatus ? "No invoices match these filters." : filter === "dues"
            ? "Nothing outstanding — every issued invoice is settled."
            : "No invoices yet. Raise one from a member's page or the member's active plan."}
        </p>
      </>
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
    <>
      {settledResult}
      {lookup}
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
                  {invoice.memberId ? (
                    <Link
                      href={`/owner/members/${invoice.memberId}`}
                      className="text-[14px] font-medium text-ink"
                    >
                      {invoice.payerName}
                    </Link>
                  ) : (
                    // WR-1 — a walk-in bill has no member, so there is
                    // no member page to open. The name shown is the
                    // walk-in's own.
                    <span className="text-[14px] font-medium text-ink">
                      {invoice.payerName}
                    </span>
                  )}
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
                      onSettled={
                        filter === "dues"
                          ? (summary) => setSettled(summary)
                          : undefined
                      }
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
    </>
  );
}
