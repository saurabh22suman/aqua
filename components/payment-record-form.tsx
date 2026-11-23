"use client";

import { useRef, useState } from "react";
import { listMembersAction } from "@/lib/actions/people";
import { listMemberInvoicesAction } from "@/lib/actions/invoices";
import type { InvoiceRow } from "@/lib/services/invoices";
import type { MemberListRow } from "@/lib/services/people";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { formatINR } from "@/lib/money/format";
import { COLLECTION_HOLD_COPY } from "@/lib/collection-hold";
import { formatDateIST } from "@/lib/time/tz";
import { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";

// PR2-C3 — the counter recording half of /reception/collect-payment.
// The picker is deliberately thin: find the member, choose an open
// invoice, and let the recovery form own the payment attempt. Every
// method the service accepts is offered in that form — cash, UPI, bank
// transfer, card terminal and other — because a collection that cannot be
// recorded honestly is either mis-booked or lost.

function openInvoices(invoices: InvoiceRow[]): InvoiceRow[] {
  return invoices.filter((invoice) =>
    (invoice.status === "issued" || invoice.status === "partial") && invoice.outstandingPaise > 0,
  );
}

export function PaymentRecordForm() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberListRow[] | null>(null);
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [member, setMember] = useState<MemberListRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [invoiceError, setInvoiceError] = useState<"lookup" | "after-payment" | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const queryRef = useRef("");
  const pendingQueryRef = useRef<string | null>(null);
  const searchRequest = useRef(0);
  const memberRequest = useRef(0);

  const trimmedQuery = query.trim();
  const busy = pendingQuery !== null;
  // Results belong only to the query that produced them; a typed change
  // disarms them immediately so a stale payer can never be picked.
  const editing = searchedQuery !== null && trimmedQuery.length > 0 && trimmedQuery !== searchedQuery;
  const collectibleInvoices = invoices?.filter((invoice) => !invoice.collectionHold) ?? [];
  const heldInvoices = invoices?.filter((invoice) => invoice.collectionHold) ?? [];
  const selectedInvoice = collectibleInvoices.find((invoice) => invoice.id === invoiceId) ?? null;

  function updateQuery(next: string) {
    queryRef.current = next;
    setQuery(next);
    if (next.trim() !== searchedQuery) {
      setResults(null);
      setError(null);
    }
  }

  async function search() {
    const searchFor = queryRef.current.trim();
    if (!searchFor || composing.current || paymentBusy) return;
    if (pendingQueryRef.current === searchFor) return;
    const request = ++searchRequest.current;
    pendingQueryRef.current = searchFor;
    setPendingQuery(searchFor);
    setError(null);
    // Same-query refreshes stay disabled in place; a different query drops
    // the old rows before its own lookup can be answered.
    if (searchFor !== searchedQuery) setResults(null);
    setSearchedQuery(searchFor);
    try {
      const rows = await listMembersAction({ search: searchFor });
      if (request !== searchRequest.current) return;
      if (queryRef.current.trim() !== searchFor) return;
      setResults(rows);
    } catch {
      if (request !== searchRequest.current) return;
      if (queryRef.current.trim() !== searchFor) return;
      setResults(null);
      setError("Could not search members.");
    } finally {
      if (request === searchRequest.current) {
        pendingQueryRef.current = null;
        setPendingQuery(null);
      }
    }
  }

  async function chooseMember(next: MemberListRow) {
    if (pendingQueryRef.current !== null || paymentBusy) return;
    const request = ++memberRequest.current;
    setMember(next);
    setResults(null);
    setInvoiceError(null);
    setError(null);
    if (member?.memberId !== next.memberId) {
      setInvoices(null);
      setInvoiceId("");
      setPaymentMessage(null);
      setReceiptId(null);
    }
    try {
      const rows = openInvoices(await listMemberInvoicesAction(next.memberId));
      if (request !== memberRequest.current) return;
      setInvoices(rows);
      // Keep a still-open invoice selected while the payer is unchanged;
      // otherwise fall back to the single open invoice, if there is one.
      const collectible = rows.filter((row) => !row.collectionHold);
      setInvoiceId((prev) =>
        collectible.some((row) => row.id === prev)
          ? prev
          : collectible.length === 1 ? collectible[0]!.id : "",
      );
    } catch {
      if (request !== memberRequest.current) return;
      setInvoiceError("lookup");
    }
  }

  function handleChildBusy(next: boolean) {
    setPaymentBusy(next);
    if (next) {
      // A new submission clears the previous list-refresh error; the
      // outcome message is replaced by the new result.
      setError(null);
      setPaymentMessage(null);
      setReceiptId(null);
    }
  }

  async function refreshAfterRecord(): Promise<number | null | undefined> {
    if (!member) return undefined;
    try {
      const rows = openInvoices(
        await listMemberInvoicesAction(member.memberId),
      );
      const current = rows.find((row) => row.id === invoiceId);
      setInvoices(rows);
      setInvoiceId(current?.collectionHold ? "" : current?.id ?? "");
      return current?.outstandingPaise ?? null;
    } catch {
      setInvoiceError("after-payment");
      return undefined;
    }
  }

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-4">
      <form onSubmit={(event) => { event.preventDefault(); void search(); }} aria-busy={busy}>
        <Field id="payment-member-search" label="Find member" description="Name, phone or member code">
          {(field) => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                {...field}
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing)) event.preventDefault();
                }}
                data-testid="payment-member-search"
                className="w-full min-w-0"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={paymentBusy || trimmedQuery.length === 0 || pendingQuery === trimmedQuery}
              >
                Search
              </Button>
            </div>
          )}
        </Field>

        {busy && pendingQuery === trimmedQuery ? (
          <p role="status" className="mt-2 text-[12.5px] text-ink-3">Searching members…</p>
        ) : editing ? (
          <p role="status" className="mt-2 text-[12.5px] text-ink-3">Press Search to update results.</p>
        ) : results ? (
          <p role="status" className="mt-2 text-[12.5px] text-ink-3">{results.length === 0 ? "No members found." : `${results.length} ${results.length === 1 ? "member" : "members"} found.`}</p>
        ) : null}
        {!editing && results && results.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {results.map((row) => (
              <li key={row.memberId}>
                <button
                  type="button"
                  disabled={busy || paymentBusy}
                  onClick={() => void chooseMember(row)}
                  data-testid={`payment-member-${row.memberId}`}
                  className="w-full min-h-11 rounded-ctl border border-line px-3 py-2 text-left text-[13px] text-ink hover:border-[var(--accent-strong)]"
                >
                  {row.fullName}
                  <span className="ml-2 font-mono text-[11.5px] text-ink-3">
                    {row.memberCode}
                  </span>
                  <span className="ml-2 text-[11.5px] text-ink-3">{row.locationName}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </form>

      {member ? (
        <section aria-labelledby="selected-payment-member" className="rounded-card border border-line bg-deck p-4">
          <h2 id="selected-payment-member" className="text-base font-semibold text-ink">Invoices for {member.fullName}</h2>
          <p className="mt-1 flex flex-wrap gap-x-2 text-sm text-ink-2">
            <span className="font-mono">
              {member.memberCode}
            </span>
            <span>{member.locationName}</span>
          </p>

          {invoiceError ? (
            <div className="mt-3 space-y-2 rounded-ctl border border-line bg-paper p-3">
              <p role="alert" className="text-sm text-ink">
                {invoiceError === "lookup"
                  ? "Could not load invoices. Check your connection and try again."
                  : "Payment recorded, but the invoice list could not be refreshed. Refresh invoices before recording another payment."}
              </p>
              <Button variant="secondary" size="sm" disabled={busy || paymentBusy} onClick={() => void chooseMember(member)}>
                Retry invoice lookup
              </Button>
            </div>
          ) : invoices === null ? (
            <p role="status" className="mt-3 text-sm text-ink-2">Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-3">
              No open invoices for this member.
            </p>
          ) : (
            <>
            {!selectedInvoice && collectibleInvoices.length > 1 ? <p className="mt-2 text-sm text-ink-2">Choose the invoice this payment belongs to.</p> : null}
            <ul className="mt-2 space-y-1">
              {collectibleInvoices.map((invoice) => (
                <li key={invoice.id}>
                  <button
                    type="button"
                    disabled={paymentBusy}
                    onClick={() => {
                      setInvoiceId(invoice.id);
                      setError(null);
                      setPaymentMessage(null);
                      setReceiptId(null);
                    }}
                    aria-pressed={invoiceId === invoice.id}
                    data-testid={`payment-invoice-${invoice.id}`}
                    className={`w-full min-h-11 rounded-ctl border px-3 py-2 text-left text-[13px] ${
                      invoiceId === invoice.id
                        ? "border-[var(--accent-strong)] text-ink"
                        : "border-line text-ink-2 hover:border-[var(--accent-strong)]"
                    }`}
                  >
                    {formatINR(invoice.outstandingPaise)} outstanding
                    <span className="ml-2 font-mono text-[11.5px] text-ink-3">
                      {invoice.invoiceNumber}
                    </span>
                    <span className="ml-2 text-[11.5px] text-ink-3">
                      due {formatDateIST(invoice.dueOn)}
                    </span>
                    <span className="ml-2 text-[11.5px] text-ink-3">{invoice.locationName}</span>
                  </button>
                </li>
              ))}
              {heldInvoices.map((invoice) => invoice.collectionHold && (
                <li key={invoice.id} className="rounded-ctl border border-line px-3 py-2 text-[13px] text-ink-2">
                  <p className="font-medium">{COLLECTION_HOLD_COPY[invoice.collectionHold].label}</p>
                  <p className="mt-1 break-words">
                    <span className="font-mono">{invoice.invoiceNumber}</span>
                    {" · "}{formatINR(invoice.outstandingPaise)} outstanding
                  </p>
                </li>
              ))}
            </ul>
            </>
          )}
        </section>
      ) : null}

      {selectedInvoice && !invoiceError ? (
        <PaymentRecordRecoveryForm
          key={selectedInvoice.id}
          invoice={selectedInvoice}
          onRecorded={refreshAfterRecord}
          searchBusy={busy}
          onBusyChange={handleChildBusy}
          onMessage={setPaymentMessage}
          onReceipt={setReceiptId}
        />
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
      {paymentMessage ? (
        <section className="rounded-ctl border border-line bg-paper p-3" aria-label="Payment outcome">
          <p role="status" className="text-sm text-ink">{paymentMessage}</p>
          {receiptId ? <a href={`/api/receipts/${encodeURIComponent(receiptId)}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-11 items-center text-sm underline">View receipt</a> : null}
        </section>
      ) : null}
    </section>
  );
}
