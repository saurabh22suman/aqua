"use client";

import { useState } from "react";
import {
  confirmCashCountAction,
  getReceptionCloseSummaryAction,
} from "@/lib/actions/reconciliation";
import type {
  ReceptionCloseLocation,
  ReceptionCloseSummary,
} from "@/lib/services/reconciliation-closed-state";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { formatDateTimeIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";

// M01 — the counter's close screen. Expected cash/UPI totals come from
// the narrow close summary (assigned locations, today only); closing
// reuses the existing confirmCashCount service, so the >₹500 reason
// rule and the >₹2,000 owner rule stay in one place. A closed day has
// no action here: reopening is the owner's (settings.manage).

const inputClass =
  "min-h-11 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

function varianceText(variancePaise: number): string {
  if (variancePaise === 0) return "matched";
  return `variance ${formatINR(Math.abs(variancePaise))} ${
    variancePaise < 0 ? "short" : "over"
  }`;
}

export function ReceptionCloseDay({
  summary,
  reviewThresholdPaise,
  ownerCloseThresholdPaise,
}: {
  summary: ReceptionCloseSummary;
  reviewThresholdPaise: number;
  ownerCloseThresholdPaise: number;
}) {
  const [current, setCurrent] = useState(summary);

  const refresh = async () => {
    const next = await getReceptionCloseSummaryAction();
    setCurrent(next);
  };

  if (current.locations.length === 0) {
    return (
      <p className="mt-6 rounded-card border border-line bg-paper px-4 py-4 text-[13px] text-ink-3">
        No location is assigned to you. Ask the owner to assign your counter
        before closing a day.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {current.locations.map((location) => (
        <CloseLocationCard
          key={location.locationId}
          location={location}
          onDate={current.onDate}
          reviewThresholdPaise={reviewThresholdPaise}
          ownerCloseThresholdPaise={ownerCloseThresholdPaise}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

function CloseLocationCard({
  location,
  onDate,
  reviewThresholdPaise,
  ownerCloseThresholdPaise,
  onChanged,
}: {
  location: ReceptionCloseLocation;
  onDate: string;
  reviewThresholdPaise: number;
  ownerCloseThresholdPaise: number;
  onChanged: () => Promise<void>;
}) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (location.closed && location.cashCount) {
    const count = location.cashCount;
    return (
      <section
        className="rounded-card border border-line bg-paper p-4"
        data-testid={`close-location-${location.locationId}`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium text-ink">
            {location.locationName}
          </h2>
          <StatusBadge tone="good">Closed</StatusBadge>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">
          Counted <span className="font-mono">{formatINR(count.countedPaise)}</span>{" "}
          against system{" "}
          <span className="font-mono">{formatINR(count.systemPaise)}</span> ·{" "}
          {varianceText(count.variancePaise)}
        </p>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {count.confirmedByName ?? "Confirmed"} ·{" "}
          {formatDateTimeIST(count.confirmedAt)}
        </p>
        {count.note ? (
          <p className="mt-1 text-[12px] text-ink-2">Reason: {count.note}</p>
        ) : null}
        {count.needsReview ? (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-2">
            <StatusBadge tone="warn">Review</StatusBadge>
            The owner will review this variance.
          </p>
        ) : null}
        <p className="mt-3 text-[13px] text-ink-2">
          Closed — ask the owner to reopen.
        </p>
      </section>
    );
  }

  const parsedCounted = parseRupeesToPaise(counted);
  const variance =
    parsedCounted === null ? null : Number(parsedCounted) - location.cashPaise;
  const needsReason =
    variance !== null && Math.abs(variance) > reviewThresholdPaise;
  const ownerOnly =
    variance !== null && Math.abs(variance) > ownerCloseThresholdPaise;

  const confirm = async () => {
    const paise = parseRupeesToPaise(counted);
    if (paise === null) {
      setMessage("Enter the counted cash, like 1200 or 1200.50.");
      return;
    }
    setBusy(true);
    setMessage(null);
    let closed = false;
    try {
      const result = await confirmCashCountAction({
        locationId: location.locationId,
        onDate,
        countedPaise: Number(paise),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (result.ok) {
        closed = true;
        setMessage(
          result.variancePaise === 0
            ? "Closed — counted cash matched."
            : `Closed — ${varianceText(result.variancePaise)}.`,
        );
      } else {
        setMessage(result.error);
      }
    } catch {
      // Genuine save failure: the close may still have gone through
      // server-side, so the copy asks for a check before a retry.
      setMessage(
        "Couldn't save the count. Check whether the day closed before retrying.",
      );
    }
    // The refresh runs outside the save try (same shape as
    // components/reports/collections-report.tsx): once the close is
    // committed, a failed refresh must not fall into the save-failure
    // copy and invite a duplicate close.
    if (closed) {
      try {
        await onChanged();
      } catch {
        // The close is committed; the success message stands.
      }
    }
    setBusy(false);
  };

  return (
    <section
      className="rounded-card border border-line bg-paper p-4"
      data-testid={`close-location-${location.locationId}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-ink">
          {location.locationName}
        </h2>
        <StatusBadge tone="neutral">Open</StatusBadge>
      </div>

      <p className="mt-2 text-[12px] text-ink-3">
        {location.paymentCount} payment
        {location.paymentCount === 1 ? "" : "s"} today · total collected{" "}
        {formatINR(location.totalPaise)}
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
        <div>
          <dt className="text-[11px] text-ink-3">Cash expected</dt>
          <dd className="font-mono text-ink">{formatINR(location.cashPaise)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-3">UPI</dt>
          <dd className="font-mono text-ink">{formatINR(location.upiPaise)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-3">Bank transfer</dt>
          <dd className="font-mono text-ink">
            {formatINR(location.bankTransferPaise)}
          </dd>
        </div>
      </dl>

      <div className="mt-3 space-y-2">
        <label className="block">
          <span className="mb-1 block text-[12px] text-ink-2">
            Counted cash (₹)
          </span>
          <input
            inputMode="decimal"
            value={counted}
            onChange={(event) => setCounted(event.target.value)}
            className={inputClass}
            placeholder="0.00"
          />
        </label>
        {variance !== null ? (
          <p className="text-[12px] text-ink-2">
            {variance === 0 ? "Matches expected cash." : varianceText(variance)}
          </p>
        ) : null}
        {needsReason ? (
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-2">
              Reason for the difference (required)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={inputClass}
              placeholder="e.g. change given twice"
            />
          </label>
        ) : null}
        {ownerOnly ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-2">
            <StatusBadge tone="warn">Owner</StatusBadge>A variance over{" "}
            {formatINR(ownerCloseThresholdPaise)} can only be closed by the
            owner or an admin.
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy || ownerOnly}
          onClick={() => void confirm()}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-pill bg-[var(--accent-strong)] px-4 py-2 text-[14px] font-medium text-paper transition-colors duration-150 hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Confirm cash count"}
        </button>
        {message ? (
          <p role="status" className="text-[12px] text-ink-2">
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
