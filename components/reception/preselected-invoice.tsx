"use client";

import { useState } from "react";
import { getInvoiceAction } from "@/lib/actions/invoices";
import type { InvoiceDetail } from "@/lib/services/invoices";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/money/format";
import { COLLECTION_HOLD_COPY } from "@/lib/collection-hold";
import { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";

export function PreselectedInvoice({ initial }: { initial: InvoiceDetail }) {
  const [invoice, setInvoice] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const holdCopy = invoice.collectionHold && invoice.outstandingPaise > 0 && invoice.status !== "void"
    ? COLLECTION_HOLD_COPY[invoice.collectionHold]
    : null;
  const open = !holdCopy
    && (invoice.status === "issued" || invoice.status === "partial")
    && invoice.outstandingPaise > 0;

  async function reload(): Promise<number | null | undefined> {
    setReloading(true);
    try {
      const current = await getInvoiceAction(invoice.id);
      if (!current) { setReloadError(true); return undefined; }
      setInvoice(current);
      setReloadError(false);
      return current.outstandingPaise > 0 ? current.outstandingPaise : null;
    } catch {
      setReloadError(true);
      return undefined;
    } finally {
      setReloading(false);
    }
  }
  return <section className="space-y-3 rounded-card border border-line bg-paper p-5">
    <h2 className="font-display text-[16px] font-semibold">{invoice.payerName}</h2>
    <p className="text-[13px] text-ink-2">Invoice {invoice.invoiceNumber} · {invoice.locationName}</p>
    <p className="text-[13px] text-ink-2">Balance {formatINR(invoice.outstandingPaise)}</p>
    {holdCopy ? (
      <div className="rounded-ctl border border-line bg-deck px-3 py-2">
        <p className="text-[13px] font-semibold text-warn">{holdCopy.label}</p>
        <p className="mt-0.5 text-[13px] text-ink-2">{holdCopy.description}</p>
      </div>
    ) : null}
    {message ? <p role="status" className="text-[13px] text-ink-2">{message}</p> : null}
    {receiptId ? <a href={`/api/receipts/${encodeURIComponent(receiptId)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline">View receipt</a> : null}
    {reloadError ? (
      <div className="rounded-ctl border border-line bg-deck p-3">
        <p role="alert" className="text-sm">Invoice could not be refreshed. Check its current state before another payment.</p>
        <Button variant="secondary" size="sm" className="mt-2" disabled={reloading} onClick={() => void reload()}>
          {reloading ? "Checking invoice…" : "Retry invoice lookup"}
        </Button>
      </div>
    ) : null}
    {open && !reloadError ? <PaymentRecordRecoveryForm invoice={invoice} onRecorded={reload} onMessage={setMessage} onReceipt={setReceiptId} /> : !reloadError && !holdCopy ? <p className="text-[13px] text-ink-2">This invoice is not currently available for collection.</p> : null}
  </section>;
}
