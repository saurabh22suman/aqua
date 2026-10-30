"use client";

import { useState } from "react";
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

  const selectedInvoice =
    invoices?.find((invoice) => invoice.id === invoiceId) ?? null;

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setResults(await listMembersAction({ search: query.trim() }));
    } catch {
      setError("Could not search members.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseMember(next: MemberListRow) {
    setMember(next);
    setResults(null);
    setInvoices(null);
    setInvoiceId("");
    setError(null);
    setPaymentMessage(null);
    try {
      const rows = openInvoices(await listMemberInvoicesAction(next.memberId));
      setInvoices(rows);
      const first = rows[0];
      if (first) setInvoiceId(first.id);
    } catch {
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
      setInvoices(rows);
      setInvoiceId(rows[0]?.id ?? "");
      return rows[0]?.outstandingPaise ?? null;
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

      <div>
        {/* Owner redesign (C2) — the shared labelled controls. The
            journey (search → choose a member → choose an invoice →
            record) and the test ids are unchanged. */}
        <Field id="payment-member-search" label="Find member">
          {() => (
            <div className="flex gap-2">
              <Input
                id="payment-member-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, phone or member code"
                data-testid="payment-member-search"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void search()}
                disabled={busy || paymentBusy || query.trim().length === 0}
              >
                Search
              </Button>
            </div>
          )}
        </Field>

        {results ? (
          results.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-ink-3">No members found.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {results.map((row) => (
                <li key={row.memberId}>
                  <button
                    type="button"
                    disabled={paymentBusy}
                    onClick={() => void chooseMember(row)}
                    data-testid={`payment-member-${row.memberId}`}
                    className="w-full min-h-11 rounded-ctl border border-line px-3 py-2 text-left text-[13px] text-ink hover:border-[var(--accent-strong)]"
                  >
                    {row.fullName}
                    <span className="ml-2 font-mono text-[11.5px] text-ink-3">
                      {row.memberCode}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      {member ? (
        <div>
          <p className="text-[13px] font-medium text-ink">
            {member.fullName}
            <span className="ml-2 font-mono text-[11.5px] text-ink-3">
              {member.memberCode}
            </span>
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
