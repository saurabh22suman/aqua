"use client";

import { useCallback, useEffect, useState } from "react";
import {
  confirmCashCountAction,
  getDailyCollectionAction,
} from "@/lib/actions/reconciliation";
import type { DailyCollection } from "@/lib/services/reconciliation";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { formatDateTimeIST } from "@/lib/time/tz";

// C-34 — the daily collection report: totals by method and by the
// staff member who took the money, plus the cash count confirmation
// step. The system figure is snapshotted at confirmation; a variance
// is surfaced, never silently adjusted.

const inputClass =
  "rounded-ctl border border-line bg-paper px-3 py-2 text-[15px] text-ink focus:border-[var(--accent)] focus:outline-none";

export function CollectionsReport({
  defaultDate,
  locations,
  facilityLabel,
  canConfirm,
}: {
  defaultDate: string;
  locations: Array<{ id: string; name: string }>;
  // Resolved from the tenant's vocabulary on the server (L3 scan:
  // "facility" can read as "lane" under the swim preset).
  facilityLabel: string;
  canConfirm: boolean;
}) {
  const [onDate, setOnDate] = useState(defaultDate);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [report, setReport] = useState<DailyCollection | null>(null);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!onDate) return;
    const data = await getDailyCollectionAction({
      onDate,
      ...(locationId ? { locationId } : {}),
    });
    setReport(data);
  }, [onDate, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (locations.length === 0) {
    return (
      <p className="mt-4 text-[13px] text-ink-3">
        Add a location before reconciling collections.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Date</span>
          <input
            type="date"
            lang="en-IN"
            placeholder="dd/mm/yyyy"
            value={onDate}
            onChange={(e) => setOnDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">
            {facilityLabel}
          </span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className={inputClass}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {report === null ? (
        <p className="text-[13px] text-ink-3">Loading collections…</p>
      ) : (
        <>
          <div className="rounded-card border border-line bg-paper p-3.5">
            <p className="text-[12px] text-ink-3">
              Collected on {report.onDate} · {report.paymentCount} payment
              {report.paymentCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1 font-display text-[22px] font-semibold text-ink">
              {formatINR(report.totalPaise)}
            </p>
            <p className="text-[12px] text-ink-3">
              Cash {formatINR(report.cashPaise)}
            </p>

            <table className="mt-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
                  <th className="py-1 font-medium">Method</th>
                  <th className="py-1 text-right font-medium">Count</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {report.byMethod.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-ink-3">
                      No payments recorded.
                    </td>
                  </tr>
                ) : (
                  report.byMethod.map((group) => (
                    <tr key={group.key} className="border-t border-line">
                      <td className="py-1.5 text-ink">{group.label}</td>
                      <td className="py-1.5 text-right text-ink-2">
                        {group.count}
                      </td>
                      <td className="py-1.5 text-right font-mono text-ink">
                        {formatINR(group.totalPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-card border border-line bg-paper p-3.5">
            <p className="text-[12px] font-medium text-ink-2">By staff</p>
            <table className="mt-2 w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-ink-3">
                  <th className="py-1 font-medium">Received by</th>
                  <th className="py-1 text-right font-medium">Count</th>
                  <th className="py-1 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {report.byStaff.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-2 text-ink-3">
                      Nothing received.
                    </td>
                  </tr>
                ) : (
                  report.byStaff.map((group) => (
                    <tr key={group.key} className="border-t border-line">
                      <td className="py-1.5 text-ink">{group.label}</td>
                      <td className="py-1.5 text-right text-ink-2">
                        {group.count}
                      </td>
                      <td className="py-1.5 text-right font-mono text-ink">
                        {formatINR(group.totalPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-card border border-line bg-paper p-3.5">
            <p className="text-[12px] font-medium text-ink-2">Cash count</p>
            {report.cashCount ? (
              <div className="mt-1.5 text-[13px] text-ink-2">
                <p>
                  Counted{" "}
                  <span className="font-mono text-ink">
                    {formatINR(report.cashCount.countedPaise)}
                  </span>{" "}
                  against system{" "}
                  <span className="font-mono text-ink">
                    {formatINR(report.cashCount.systemPaise)}
                  </span>{" "}
                  ·{" "}
                  <span
                    className={
                      report.cashCount.variancePaise === 0
                        ? "text-marine"
                        : "font-medium text-ink"
                    }
                  >
                    {report.cashCount.variancePaise === 0
                      ? "matched"
                      : `variance ${formatINR(Math.abs(report.cashCount.variancePaise))} ${
                          report.cashCount.variancePaise < 0 ? "short" : "over"
                        }`}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {report.cashCount.confirmedByName ?? "Confirmed"} on{" "}
                  {formatDateTimeIST(report.cashCount.confirmedAt)}
                  {report.cashCount.note ? ` · ${report.cashCount.note}` : ""}
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-[12px] text-ink-3">
                Not counted yet for this day.
              </p>
            )}

            {canConfirm ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-0.5 block text-[11px] text-ink-3">
                    Counted cash (₹)
                  </span>
                  <input
                    inputMode="decimal"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </label>
                <label className="block grow">
                  <span className="mb-0.5 block text-[11px] text-ink-3">
                    Note (optional)
                  </span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className={`${inputClass} w-full`}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const paise = parseRupeesToPaise(counted);
                    if (paise === null) {
                      setMessage("Enter the counted cash, like 1200 or 1200.50.");
                      return;
                    }
                    setBusy(true);
                    setMessage(null);
                    void (async () => {
                      const result = await confirmCashCountAction({
                        locationId,
                        onDate,
                        countedPaise: Number(paise),
                        ...(note.trim() ? { note: note.trim() } : {}),
                      });
                      setMessage(
                        result.ok
                          ? result.variancePaise === 0
                            ? "Counted and matched."
                            : `Counted — variance ${formatINR(Math.abs(result.variancePaise))} ${result.variancePaise < 0 ? "short" : "over"}.`
                          : result.error,
                      );
                      await load();
                      setBusy(false);
                    })();
                  }}
                  className="rounded-pill px-4 py-2 text-[13px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Saving…" : report.cashCount ? "Recount" : "Confirm count"}
                </button>
              </div>
            ) : null}

            {message ? (
              <p role="status" className="mt-2 text-[12px] text-ink-2">
                {message}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
