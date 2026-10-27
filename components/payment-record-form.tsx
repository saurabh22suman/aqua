"use client";

import { useState } from "react";
import { listMembersAction } from "@/lib/actions/people";
import { listMemberInvoicesAction } from "@/lib/actions/invoices";
import { recordPaymentAction } from "@/lib/actions/payments";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { formatINR } from "@/lib/money/format";
import { formatDateIST } from "@/lib/time/tz";
import type { InvoiceRow } from "@/lib/services/invoices";
import type { MemberListRow } from "@/lib/services/people";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

// PR2-C3 — the counter recording half of /reception/collect-payment.
// A receptionist finds the member, picks an open invoice and records
// cash or UPI through the existing recordPayment service (no parallel
// money path). UPI requires its reference; the server's refusal is
// shown verbatim.

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
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<"cash" | "upi">("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedInvoice =
    invoices?.find((invoice) => invoice.id === invoiceId) ?? null;
  const amountPaise = parseRupeesToPaise(amountText);

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
    setMessage(null);
    setError(null);
    try {
      const rows = openInvoices(await listMemberInvoicesAction(next.memberId));
      setInvoices(rows);
      const first = rows[0];
      if (first) {
        setInvoiceId(first.id);
        setAmountText((first.outstandingPaise / 100).toFixed(2));
      }
    } catch {
      setError("Could not load invoices for this member.");
    }
  }

  function submit() {
    if (!selectedInvoice) return;
    if (amountPaise === null || amountPaise <= 0n) {
      setError("Enter an amount like 2500 or 2500.50.");
      return;
    }
    if (method !== "cash" && reference.trim().length === 0) {
      setError("A UPI payment needs its reference (UTR / transaction id).");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const result = await recordPaymentAction({
          invoiceId: selectedInvoice.id,
          amountPaise: Number(amountPaise),
          method,
          ...(method === "cash" ? {} : { reference: reference.trim() }),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setMessage(
          result.invoiceStatus === "paid"
            ? "Payment recorded. Invoice is now paid."
            : "Payment recorded. Invoice is now partially paid.",
        );
        const rows = openInvoices(
          await listMemberInvoicesAction(member!.memberId),
        );
        setInvoices(rows);
        setInvoiceId(rows[0]?.id ?? "");
        setAmountText(rows[0] ? (rows[0].outstandingPaise / 100).toFixed(2) : "");
        setReference("");
      } catch {
        setError("The payment could not be recorded. Try again.");
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <section className="rounded-card bg-paper border border-line p-5 space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold text-ink">
          Record a payment
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-3">
          Cash or UPI against an open invoice — the same ledger the owner
          sees.
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
                disabled={busy || query.trim().length === 0}
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
                    onClick={() => {
                      setInvoiceId(invoice.id);
                      setAmountText((invoice.outstandingPaise / 100).toFixed(2));
                      setError(null);
                      setMessage(null);
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
        <div className="space-y-3 border-t border-line pt-3">
          <Field id="payment-amount" label="Amount (₹)">
            {() => (
              <Input
                id="payment-amount"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                inputMode="decimal"
                data-testid="payment-amount"
              />
            )}
          </Field>

          <fieldset>
            <legend className="text-[12px] font-medium text-ink-2 mb-1">
              Method
            </legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="radio"
                  name="payment-method"
                  checked={method === "cash"}
                  onChange={() => setMethod("cash")}
                />
                Cash
              </label>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="radio"
                  name="payment-method"
                  checked={method === "upi"}
                  onChange={() => setMethod("upi")}
                />
                UPI
              </label>
            </div>
          </fieldset>

          {method === "upi" ? (
            <Field id="payment-reference" label="UPI reference (UTR / transaction id)">
              {() => (
                <Input
                  id="payment-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  data-testid="payment-reference"
                />
              )}
            </Field>
          ) : null}

          <Button
            type="button"
            variant="primary"
            onClick={submit}
            disabled={busy}
            className="w-full"
          >
            {busy ? "Recording…" : "Record payment"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12.5px] text-ink-2"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-[12.5px] text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
