"use client";

import { useState } from "react";
import { LinkQr } from "@/components/link-qr";
import {
  buildUpiUri,
  parseRupeesToPaise,
} from "@/lib/payment-qr";
import type { PaymentQrRow } from "@/lib/services/payment-qrs";

// C-36 — reception's read-only collect screen: pick a QR by nickname,
// optionally type an amount, show the QR large for the payer to scan.
// Nothing here mutates: no create, edit or delete.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

export function CollectPayment({ qrs }: { qrs: PaymentQrRow[] }) {
  const [selectedId, setSelectedId] = useState(qrs[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");

  const selected = qrs.find((qr) => qr.id === selectedId) ?? qrs[0];
  if (!selected) return null;

  const trimmedAmount = amountText.trim();
  const amountPaise =
    trimmedAmount.length > 0 ? parseRupeesToPaise(trimmedAmount) : undefined;
  const amountInvalid = trimmedAmount.length > 0 && amountPaise === null;

  const upiUri =
    selected.kind === "upi" && selected.upiId && selected.payeeName
      ? buildUpiUri(
          { upiId: selected.upiId, payeeName: selected.payeeName },
          amountInvalid ? undefined : (amountPaise ?? undefined),
        )
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded-card bg-paper border border-line p-5 space-y-4">
        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Payment QR
          </span>
          <select
            value={selected.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className={inputClass}
            data-testid="collect-qr-select"
          >
            {qrs.map((qr) => (
              <option key={qr.id} value={qr.id}>
                {qr.nickname}
                {qr.kind === "image" ? " (image)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[12px] font-medium text-ink-2 mb-1">
            Amount (₹, optional
            {selected.kind === "image" ? " — not supported by image QRs" : ""})
          </span>
          <input
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
            placeholder="2500"
            disabled={selected.kind === "image"}
            data-testid="collect-amount"
            className={`${inputClass} disabled:opacity-50`}
          />
        </label>
        {amountInvalid ? (
          <p role="alert" className="text-[12px] text-ink-2">
            Enter an amount like 2500 or 2500.50.
          </p>
        ) : null}
      </section>

      <section
        className="rounded-card bg-paper border border-line p-5 flex flex-col items-center"
        data-testid="collect-qr"
      >
        {selected.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/payment-qr/${selected.id}/image`}
            alt={`${selected.nickname} payment QR`}
            className="h-[260px] w-[260px] rounded-ctl border border-line bg-paper object-contain p-2"
          />
        ) : upiUri ? (
          <LinkQr url={upiUri} size={260} />
        ) : null}
        <p className="mt-3 text-[13px] text-ink-2 text-center">
          {selected.kind === "upi"
            ? `${selected.payeeName} · ${selected.upiId}`
            : selected.nickname}
        </p>
        {selected.kind === "upi" && amountPaise !== undefined && !amountInvalid ? (
          <p className="mt-1 text-[13px] font-medium text-ink" data-testid="collect-amount-shown">
            ₹{amountText.trim()}
          </p>
        ) : null}
        <p className="mt-2 text-[12px] text-ink-3 text-center">
          The payer scans with any UPI app. Record the payment once it
          lands.
        </p>
      </section>
    </div>
  );
}
