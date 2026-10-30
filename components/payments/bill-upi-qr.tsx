"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { listPaymentQrsAction } from "@/lib/actions/payment-qrs";
import { buildUpiUri } from "@/lib/payment-qr";
import { formatINR } from "@/lib/money/format";
import type { PaymentQrRow } from "@/lib/services/payment-qrs";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { LinkQr } from "@/components/link-qr";

// A bill-linked UPI payment REQUEST. The component only reads the
// owner-configured accounts (settings.read) and encodes the SAME bigint
// amount the form will submit. It never creates an intent, records money
// or marks the invoice paid. An uploaded image QR has no amount field;
// it is never presented as if it carries this bill amount.

export function BillUpiQr({
  invoiceId,
  invoiceNumber,
  amountPaise,
  outstandingPaise,
  blockedReason,
}: {
  invoiceId: string;
  invoiceNumber: string;
  amountPaise: bigint | null;
  outstandingPaise: bigint;
  blockedReason?: string;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const activeInvoice = useRef(invoiceId);
  const open = openFor === invoiceId;
  const [loading, setLoading] = useState(false);
  const [qrs, setQrs] = useState<PaymentQrRow[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [encodeError, setEncodeError] = useState(false);

  const amountValid =
    amountPaise !== null &&
    amountPaise > 0n &&
    amountPaise <= outstandingPaise;
  const upiQrs = useMemo(
    () => (qrs ?? []).filter((qr) => qr.kind === "upi" && qr.upiId && qr.payeeName),
    [qrs],
  );
  const selected = upiQrs.find((qr) => qr.id === selectedId) ?? upiQrs[0];
  const upiUri =
    amountValid && selected?.upiId && selected.payeeName
      ? buildUpiUri(
          { upiId: selected.upiId, payeeName: selected.payeeName },
          amountPaise,
        )
      : null;

  useEffect(() => {
    // A different bill is a different payment request: hide any open QR,
    // invalidate an in-flight account read and re-read only after an explicit
    // Show. A late response from the old bill must never replace this one.
    activeInvoice.current = invoiceId;
    requestSeq.current += 1;
    setOpenFor(null);
    setQrs(null);
    setSelectedId("");
    setUnavailable(null);
    setEncodeError(false);
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    setEncodeError(false);
  }, [upiUri]);

  if (blockedReason) {
    return (
      <div
        className="rounded-ctl border border-line bg-deck px-3 py-2 text-[12px] text-ink-2"
        data-testid="bill-upi-blocked"
      >
        {blockedReason}
      </div>
    );
  }

  async function showQr() {
    setOpenFor(invoiceId);
    if (qrs !== null) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    const targetInvoice = invoiceId;
    setLoading(true);
    setUnavailable(null);
    try {
      const rows = await listPaymentQrsAction();
      if (seq !== requestSeq.current || activeInvoice.current !== targetInvoice) {
        return;
      }
      const active = rows.filter((qr) => qr.isActive);
      setQrs(active);
      const firstUpi = active.find(
        (qr) => qr.kind === "upi" && qr.upiId && qr.payeeName,
      );
      setSelectedId(firstUpi?.id ?? "");
      if (!firstUpi) {
        setUnavailable(
          active.some((qr) => qr.kind === "image")
            ? "Only image QRs are configured. An image QR cannot carry this bill amount, so record the payment manually or ask the owner to add a UPI ID QR."
            : "No active UPI account is configured. Record the payment manually or ask the owner to add one.",
        );
      }
    } catch {
      if (seq === requestSeq.current && activeInvoice.current === targetInvoice) {
        setUnavailable(
          "Could not load a UPI account. Record the payment manually.",
        );
      }
    } finally {
      if (seq === requestSeq.current && activeInvoice.current === targetInvoice) {
        setLoading(false);
      }
    }
  }

  return (
    <div
      className="mt-3 rounded-ctl border border-line bg-deck p-3 space-y-2"
      data-testid="bill-upi-qr"
      data-invoice-id={invoiceId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium text-ink-2">
            UPI payment request
          </p>
          <p className="text-[11.5px] text-ink-3">
            The QR uses this bill&apos;s current amount. It does not record a
            payment.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void showQr()}
          disabled={!amountValid || loading}
        >
          Show UPI QR
        </Button>
      </div>

      {!amountValid ? (
        <p role="status" className="text-[12px] text-ink-2">
          Enter an amount within the outstanding balance to show the UPI QR.
        </p>
      ) : null}

      {open && amountValid ? (
        <div className="space-y-2" data-testid="bill-upi-open">
          {loading ? (
            <p role="status" className="text-[12px] text-ink-2">
              Preparing UPI QR…
            </p>
          ) : null}
          {unavailable ? (
            <p role="alert" className="text-[12px] text-ink-2">
              {unavailable}
            </p>
          ) : null}
          {selected && upiQrs.length > 1 ? (
            <Field id="bill-upi-account" label="Receiving UPI account">
              {(field) => (
                <Select
                  {...field}
                  value={selected.id}
                  onChange={(event) => setSelectedId(event.target.value)}
                  data-testid="bill-upi-account"
                >
                  {upiQrs.map((qr) => (
                    <option key={qr.id} value={qr.id}>
                      {qr.nickname} · {qr.upiId}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {selected && upiUri ? (
            <>
              <div className="flex flex-col items-center gap-2">
                <LinkQr
                  url={upiUri}
                  size={220}
                  onError={() => setEncodeError(true)}
                />
                {encodeError ? (
                  <p role="alert" className="text-[12px] text-ink-2">
                    Could not create the UPI QR. Record the payment manually.
                  </p>
                ) : null}
              </div>
              <div className="text-center">
                <p className="text-[13px] text-ink">
                  {selected.payeeName} · {selected.upiId}
                </p>
                <p
                  className="text-[13px] font-medium text-ink"
                  data-testid="bill-upi-amount"
                >
                  {formatINR(amountPaise)}
                </p>
                <p
                  className="text-[11.5px] text-ink-3"
                  data-testid="bill-upi-invoice"
                >
                  Invoice {invoiceNumber}
                </p>
                <p className="mt-2 text-[11.5px] text-ink-3">
                  Payment request only. Showing this QR does not mark the
                  invoice paid. It cannot be cancelled once a payer has saved or
                  scanned it. After the money lands, enter the UPI reference/UTR
                  and record the payment.
                </p>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
