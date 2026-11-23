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
import { formatDateTimeIST, formatWeekdayDateIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

// M01 — the counter's close screen. Expected cash/UPI totals come from
// the narrow close summary (assigned locations, today only); closing
// reuses the existing confirmCashCount service, so the >₹500 reason
// rule and the >₹2,000 owner rule stay in one place. A closed day has
// no action here: reopening is the owner's (settings.manage).

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
    return next;
  };

  if (current.locations.length === 0) {
    return (
      <p className="mt-6 rounded-2xl border border-line bg-paper px-4 py-4 text-[13px] text-ink-3">
        No location is assigned to you. Ask the owner to assign your counter
        before closing a day.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-[13px] font-medium text-ink-2">
        Cash close for {formatWeekdayDateIST(current.onDate)}
      </p>
      {current.locations.map((location) => (
        <CloseLocationCard
          key={`${current.onDate}:${location.locationId}`}
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
  onChanged: () => Promise<ReceptionCloseSummary>;
}) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"save" | "check" | null>(null);
  const [outcome, setOutcome] = useState<"open" | "unknown" | "saved">("open");
  const [message, setMessage] = useState<string | null>(null);

  if (location.closed && location.cashCount) {
    const count = location.cashCount;
    return (
      <section
        className="rounded-2xl border border-line bg-paper p-4"
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

  const parsed = parseRupeesToPaise(counted);
  const countedPaise = parsed === null ? null : Number(parsed);
  const variance = countedPaise !== null && Number.isSafeInteger(countedPaise)
    ? countedPaise - location.cashPaise : null;
  const needsReason = variance !== null && Math.abs(variance) > reviewThresholdPaise;
  const ownerOnly = variance !== null && Math.abs(variance) > ownerCloseThresholdPaise;

  async function checkStatus() {
    setPending("check");
    try {
      const next = await onChanged();
      const counter = next.locations.find((item) => item.locationId === location.locationId);
      if (next.onDate === onDate && counter && !counter.closed) {
        if (outcome === "unknown") {
          setOutcome("open");
          setMessage("Still open. Review the count before confirming again.");
        } else {
          setMessage("The count was saved, but the refreshed status still shows open. Check again or ask the owner.");
        }
      }
    } catch {
      setMessage("Could not check the close status. Try checking again.");
    } finally {
      setPending(null);
    }
  }

  async function confirm() {
    if (outcome !== "open" || pending !== null || ownerOnly) return;
    if (countedPaise === null || variance === null) {
      setMessage("Enter the counted cash, like 1200 or 1200.50.");
      return;
    }
    if (needsReason && !note.trim()) {
      setMessage("Enter a reason for the difference.");
      return;
    }

    setPending("save");
    setMessage(null);
    try {
      const result = await confirmCashCountAction({
        locationId: location.locationId,
        onDate,
        countedPaise,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setOutcome("saved");
      setMessage(result.variancePaise === 0
        ? "Closed — counted cash matched."
        : `Closed — ${varianceText(result.variancePaise)}.`);
      // The write was confirmed. A failed follow-up read must leave
      // that outcome in place and never re-enable the submit button.
      try { await onChanged(); } catch { /* The saved outcome still stands. */ }
    } catch {
      setOutcome("unknown");
      setMessage("We couldn't confirm the cash close. Check whether the day closed before retrying.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4" data-testid={`close-location-${location.locationId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="min-w-0 break-words text-[16px] font-semibold text-ink">{location.locationName}</h2>
        <StatusBadge tone={outcome === "saved" ? "good" : outcome === "unknown" ? "warn" : "neutral"}>
          {outcome === "saved" ? "Closed" : outcome === "unknown" ? "Status unconfirmed" : "Open"}
        </StatusBadge>
      </div>

      <div className="mt-3 rounded-ctl border border-line bg-deck px-3 py-2.5">
        <p className="text-[12px] font-medium text-ink-2">Cash expected</p>
        <p className="mt-0.5 text-[24px] font-semibold leading-tight tabular-nums text-ink [overflow-wrap:anywhere]">{formatINR(location.cashPaise)}</p>
      </div>

      <form className="mt-3 space-y-2" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
        <label className="block">
          <span className="mb-1 block text-[13px] text-ink-2">Counted cash (₹)</span>
          <Input inputMode="decimal" maxLength={24} value={counted} readOnly={outcome !== "open" || pending !== null}
            onChange={(event) => setCounted(event.target.value)} placeholder="0.00" />
        </label>
        <p aria-live="polite" className="text-[13px] text-ink-2">
          {variance === null ? null : variance === 0 ? "Matches expected cash." : varianceText(variance)}
        </p>
        {needsReason && !ownerOnly ? (
          <label className="block">
            <span className="mb-1 block text-[13px] text-ink-2">Reason for the difference (required)</span>
            <Input value={note} maxLength={500} required readOnly={outcome !== "open" || pending !== null}
              onChange={(event) => setNote(event.target.value)} placeholder="e.g. change given twice" />
          </label>
        ) : null}
        {ownerOnly ? (
          <p className="text-[13px] text-ink-2">
            An owner or admin must close a difference over {formatINR(ownerCloseThresholdPaise)}.
          </p>
        ) : null}
        <Button type="submit" variant="primary" disabled={pending !== null || ownerOnly || outcome !== "open"} className="w-full">
          {pending === "save" ? "Saving…" : "Confirm cash count"}
        </Button>
        {message ? <p role="status" className="text-[13px] text-ink-2">{message}</p> : null}
        {outcome !== "open" ? (
          <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => void checkStatus()}>
            {pending === "check" ? "Checking close status…" : "Check close status"}
          </Button>
        ) : null}
      </form>

      <details className="mt-2 border-t border-line">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-[13px] font-medium text-water">
          Recorded collections
        </summary>
        <p className="text-[12px] text-ink-3">
          {location.paymentCount} payment{location.paymentCount === 1 ? "" : "s"} today · {formatINR(location.totalPaise)} total
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-[13px]">
          <div><dt className="text-ink-3">UPI</dt><dd className="tabular-nums text-ink">{formatINR(location.upiPaise)}</dd></div>
          <div><dt className="text-ink-3">Bank transfer</dt><dd className="tabular-nums text-ink">{formatINR(location.bankTransferPaise)}</dd></div>
        </dl>
      </details>
    </section>
  );
}
