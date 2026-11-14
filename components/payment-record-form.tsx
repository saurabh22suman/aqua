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
import { formatDateIST } from "@/lib/time/tz";
import { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";

// PR2-C3 — the counter recording half of /reception/collect-payment.
// The picker is deliberately thin: find the member, choose an open
// invoice, and let the recovery form own the payment attempt. Every
// method the service accepts is offered in that form — cash, UPI, bank
// transfer, card terminal and other — because a collection that cannot be
// recorded honestly is either mis-booked or lost.

function openInvoices(invoices: InvoiceRow[]): InvoiceRow[] {
  return invoices.filter(
    (invoice) =>
      invoice.status !== "void" &&
      invoice.status !== "paid" &&
      invoice.outstandingPaise > 0,
  );
}

export function PaymentRecordForm() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberListRow[] | null>(null);
  const [member, setMember] = useState<MemberListRow | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = useRef(false);
  const composing = useRef(false);
  const memberRequest = useRef(0);

  const selectedInvoice =
    invoices?.find((invoice) => invoice.id === invoiceId) ?? null;

  async function search() {
    if (searching.current || paymentBusy || composing.current || !query.trim()) return;
    searching.current = true;
    setBusy(true);
    setError(null);
    try {
      setResults(await listMembersAction({ search: query.trim() }));
    } catch {
      setError("Could not search members.");
    } finally {
      searching.current = false;
      setBusy(false);
    }
  }

  async function chooseMember(next: MemberListRow) {
    if (searching.current || paymentBusy) return;
    const request = ++memberRequest.current;
    setMember(next);
    setResults(null);
    setInvoices(null);
    setInvoiceId("");
    setError(null);
    setPaymentMessage(null);
    try {
      const rows = openInvoices(await listMemberInvoicesAction(next.memberId));
      if (request !== memberRequest.current) return;
      setInvoices(rows);
      const first = rows[0];
      if (first) setInvoiceId(first.id);
    } catch {
      if (request !== memberRequest.current) return;
      setError("Could not load invoices for this member.");
    }
  }

  function handleChildBusy(next: boolean) {
    setPaymentBusy(next);
    if (next) {
      // A new submission clears the previous list-refresh error; the
      // outcome message is replaced by the new result.
      setError(null);
      setPaymentMessage(null);
    }
  }

  async function refreshAfterRecord(): Promise<number | null | undefined> {
    try {
      const rows = openInvoices(
        await listMemberInvoicesAction(member!.memberId),
      );
      const current = rows.find((row) => row.id === invoiceId);
      setInvoices(rows);
      setInvoiceId(current?.id ?? "");
      return current?.outstandingPaise ?? null;
    } catch {
      setError(
        "Payment recorded, but the invoice list could not be refreshed. Check the member's invoices before recording another payment.",
      );
      return undefined;
    }
  }

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-ink">
          Record a payment
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-3">
          Cash, UPI, card or bank transfer against an open invoice — the
          same ledger the owner sees.
        </p>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void search(); }}>
        {/* Owner redesign (C2) — the shared labelled controls. The
            journey (search → choose a member → choose an invoice →
            record) and the test ids are unchanged. */}
        <Field id="payment-member-search" label="Find member">
          {() => (
            /* The row STACKS on a phone and sits side by side from the
             * `sm` breakpoint up.
             *
             * Measured in the browser (not guessed): at 390px the field's
             * content box was 188px wide and the placeholder "Name,
             * phone or member code" needs 223px of advance, so the
             * placeholder was clipped by 35px — and by 65px at 360px.
             * Letting the field shrink beside the button cannot fix
             * that: the placeholder needs the WHOLE measure.
             *
             * So on a phone the button sits UNDER the field and the
             * field keeps the full width; from `sm` up the row is the
             * familiar field-and-button pair again. The journey, the
             * action, the values, the recovery path and the shared
             * primitives are unchanged. */
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Input
                id="payment-member-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (composing.current || event.nativeEvent.isComposing)) event.preventDefault();
                }}
                placeholder="Name, phone or member code"
                data-testid="payment-member-search"
                className="w-full sm:min-w-0 sm:flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={busy || paymentBusy || query.trim().length === 0}
                className="w-full sm:w-auto sm:flex-none"
              >
                Search
              </Button>
            </div>
          )}
        </Field>

        {results ? (
          results.length === 0 ? (
            <p role="status" className="mt-2 text-[12.5px] text-ink-3">No members found.</p>
          ) : (
            <>
            <p role="status" className="mt-2 text-[12.5px] text-ink-3">{results.length} {results.length === 1 ? "member" : "members"} found.</p>
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
            </>
          )
        ) : null}
      </form>

      {member ? (
        <div>
          <p className="text-[13px] font-medium text-ink">
            {member.fullName}
            <span className="ml-2 font-mono text-[11.5px] text-ink-3">
              {member.memberCode}
            </span>
            <span className="ml-2 text-[11.5px] text-ink-3">{member.locationName}</span>
          </p>

          {invoices === null ? (
            <p className="mt-1 text-[12.5px] text-ink-3">Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="mt-1 text-[12.5px] text-ink-3">
              No open invoices for this member.
            </p>
          ) : (
            <ul className="mt-2 space-y-1">
              {invoices.map((invoice) => (
                <li key={invoice.id}>
                  <button
                    type="button"
                    disabled={paymentBusy}
                    onClick={() => {
                      setInvoiceId(invoice.id);
                      setError(null);
                      setPaymentMessage(null);
                    }}
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
            </ul>
          )}
        </div>
      ) : null}

      {selectedInvoice ? (
        <PaymentRecordRecoveryForm
          key={selectedInvoice.id}
          invoice={selectedInvoice}
          onRecorded={refreshAfterRecord}
          searchBusy={busy}
          onBusyChange={handleChildBusy}
          onMessage={setPaymentMessage}
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
        <p role="status" className="text-[12.5px] text-ink-2">
          {paymentMessage}
        </p>
      ) : null}
    </section>
  );
}
