"use client";

import { useState } from "react";
import { getInvoiceAction } from "@/lib/actions/invoices";
import type { InvoiceDetail } from "@/lib/services/invoices";
import { formatINR } from "@/lib/money/format";
import { PaymentRecordRecoveryForm } from "@/components/reception/payment-record-recovery-form";

export function PreselectedInvoice({ initial }: { initial: InvoiceDetail }) {
  const [invoice, setInvoice] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState(false);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const open = (invoice.status === "issued" || invoice.status === "partial") && invoice.outstandingPaise > 0;

  async function reload(): Promise<number | null | undefined> {
    try {
      const current = await getInvoiceAction(invoice.id);
      if (!current) { setReloadError(true); return undefined; }
      setInvoice(current);
      setReloadError(false);
      return current.outstandingPaise > 0 ? current.outstandingPaise : null;
    } catch {
      setReloadError(true);
      return undefined;
    }
  }
  return <section className="space-y-3 rounded-card border border-line bg-paper p-5">
    <h2 className="font-display text-[16px] font-semibold">{invoice.payerName}</h2>
    <p className="text-[13px] text-ink-2">Invoice {invoice.invoiceNumber} · {invoice.locationName}</p>
    <p className="text-[13px] text-ink-2">Balance {formatINR(invoice.outstandingPaise)}</p>
    {message ? <p role="status" className="text-[13px] text-ink-2">{message}</p> : null}
    {receiptId ? <a href={`/api/receipts/${encodeURIComponent(receiptId)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-[13px] text-ink-2 underline">View receipt</a> : null}
    {reloadError ? <p role="alert">Invoice could not be refreshed. Check its current state before another payment.</p> : null}
    {open && !reloadError ? <PaymentRecordRecoveryForm invoice={invoice} onRecorded={reload} onMessage={setMessage} onReceipt={setReceiptId} /> : <p className="text-[13px] text-ink-2">This invoice is not currently available for collection.</p>}
  </section>;
}
