"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmCashCountAction,
  getDailyCollectionAction,
  reopenCashCountAction,
} from "@/lib/actions/reconciliation";
import type { DailyCollection } from "@/lib/services/reconciliation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import { formatDateIST, formatDateTimeIST } from "@/lib/time/tz";

// C-34 — the daily collection report: totals by method and by the
// staff member who took the money, plus the cash count confirmation
// step. The system figure is snapshotted at confirmation; a variance
// is surfaced, never silently adjusted.
//
// C05 (2026-10-09 role/content/permission audit §9) — a closed day is
// a closed state, not a recount prompt: the old button said "Recount"
// and called confirm again, which the service refuses. A closed count
// now shows its badge, figures and confirmer; only a settings.manage
// holder can Reopen it, with a required reason. The >₹500 reason rule
// and the >₹2,000 owner rule are mirrored from the service so the
// form explains itself before the server has to refuse.
//
// P1 (2026-10-13 owner-UI review) — evidence and action are bound to
// the same (date, facility). A scope change clears the actionable
// report and any cash-count draft, disables confirmation until the
// new scope's evidence has loaded, discards out-of-order responses,
// and names the confirmed scope in the outcome message.

// Mirrors REVIEW_THRESHOLD_PAISE / OWNER_CLOSE_THRESHOLD_PAISE in
// lib/services/reconciliation.ts (not imported: that module is
// server-only and must not enter the client bundle).
const REVIEW_THRESHOLD_PAISE = 50_000; // ₹500
const OWNER_CLOSE_THRESHOLD_PAISE = 200_000; // ₹2,000

const inputClass =
  "min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

type ReportState = { scope: string; data: DailyCollection };

export function CollectionsReport({
  defaultDate,
  locations,
  facilityLabel,
  canConfirm,
  canReopen,
}: {
  defaultDate: string;
  locations: Array<{ id: string; name: string }>;
  // Resolved from the tenant's vocabulary on the server (L3 scan:
  // "facility" can read as "lane" under the swim preset).
  facilityLabel: string;
  canConfirm: boolean;
  // settings.manage — the same owner/admin grant the over-₹2,000
  // close and the reopen service enforce.
  canReopen: boolean;
}) {
  const [onDate, setOnDate] = useState(defaultDate);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [state, setState] = useState<ReportState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const requestSeq = useRef(0);
  const loadedScope = useRef<string | null>(null);
  // The scope currently on screen, readable from async callbacks
  // without stale closures.
  const scopeRef = useRef({ onDate, locationId });
  scopeRef.current = { onDate, locationId };

  const scopeKey = `${onDate}|${locationId}`;

  const load = useCallback(async (scope: { onDate: string; locationId: string }) => {
    if (!scope.onDate) return;
    const key = `${scope.onDate}|${scope.locationId}`;
    const seq = ++requestSeq.current;
    setLoadError(false);
    try {
      const data = await getDailyCollectionAction({
        onDate: scope.onDate,
        ...(scope.locationId ? { locationId: scope.locationId } : {}),
      });
      // Older responses are discarded; the scope tag additionally
      // stops any mismatched result from rendering.
      if (seq !== requestSeq.current) return;
      setState({ scope: key, data });
    } catch {
      if (seq === requestSeq.current) setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (loadedScope.current === scopeKey) return;
    loadedScope.current = scopeKey;
    // A draft count/note belongs to the scope it was typed under; it
    // must not silently carry into another day or facility.
    setCounted("");
    setNote("");
    setMessage(null);
    setReopenOpen(false);
    setReopenReason("");
    setState((current) => (current && current.scope === scopeKey ? current : null));
    void load({ onDate, locationId });
  }, [scopeKey, onDate, locationId, load]);

  const report = state && state.scope === scopeKey ? state.data : null;
  const locationName =
    locations.find((location) => location.id === locationId)?.name ?? "this facility";
  const scopeLabel = `${formatDateIST(onDate)} · ${locationName}`;

  // C05 — after an uncertain failure (thrown, response lost) the
  // report is reloaded before the busy state is released, so a retry
  // is never offered against a figure that might already be stale.
  // Same recovery shape as member-detail/invoice-expanded.tsx.
  function confirmCount() {
    if (!report) {
      setMessage("Wait for this day's figures to load before confirming a count.");
      return;
    }
    const paise = parseRupeesToPaise(counted);
    if (paise === null) {
      setMessage("Enter the counted cash, like 1200 or 1200.50.");
      return;
    }
    // The action is bound to the scope whose evidence is displayed.
    const target = { onDate, locationId };
    const targetLabel = `${formatDateIST(target.onDate)} · ${
      locations.find((location) => location.id === target.locationId)?.name ?? "this facility"
    }`;
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await confirmCashCountAction({
          locationId: target.locationId,
          onDate: target.onDate,
          countedPaise: Number(paise),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        setMessage(
          result.ok
            ? result.variancePaise === 0
              ? `Counted and matched for ${targetLabel}.`
              : `Counted for ${targetLabel} — variance ${formatINR(Math.abs(result.variancePaise))} ${result.variancePaise < 0 ? "short" : "over"}.`
            : result.error,
        );
        await load(scopeRef.current);
      } catch {
        try {
          await load(scopeRef.current);
        } catch {
          // load() has no failed state here; the message below still
          // tells the operator to check before retrying.
        }
        setMessage(
          "The request did not complete. The report was refreshed — check the cash count before retrying, in case the close already went through.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }

  function reopenCount() {
    if (busy) return;
    if (!report) {
      setMessage("Wait for this day's figures to load before reopening a count.");
      return;
    }
    const reason = reopenReason.trim();
    if (!reason) {
      setMessage("A reason is required to reopen a count.");
      return;
    }
    const target = { onDate, locationId };
    const targetLabel = `${formatDateIST(target.onDate)} · ${
      locations.find((location) => location.id === target.locationId)?.name ?? "this facility"
    }`;
    setBusy(true);
    setMessage(null);
    void (async () => {
      try {
        const result = await reopenCashCountAction({
          locationId: target.locationId,
          onDate: target.onDate,
          reason,
        });
        setMessage(
          result.ok
            ? `Count reopened for ${targetLabel} — you can recount and confirm now.`
            : result.error,
        );
        if (result.ok) {
          setReopenOpen(false);
          setReopenReason("");
          setCounted("");
          setNote("");
        }
        await load(scopeRef.current);
      } catch {
        try {
          await load(scopeRef.current);
        } catch {
          // load() has no failed state here; the message below still
          // tells the operator to check before retrying.
        }
        setMessage(
          "The request did not complete. The report was refreshed — check the cash count before retrying, in case the reopen already went through.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }

  // C05 — the prospective variance is known client-side (system cash
  // is report.cashPaise), so the form explains the rule as the count
  // is typed instead of after a server refusal.
  const countedPaise = report ? parseRupeesToPaise(counted) : null;
  const pendingVariancePaise =
    report && countedPaise !== null
      ? Number(countedPaise) - report.cashPaise
      : null;
  const varianceNeedsReason =
    pendingVariancePaise !== null &&
    Math.abs(pendingVariancePaise) > REVIEW_THRESHOLD_PAISE;
  const varianceNeedsOwner =
    pendingVariancePaise !== null &&
    Math.abs(pendingVariancePaise) > OWNER_CLOSE_THRESHOLD_PAISE;

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

      {!onDate ? (
        <p className="text-[13px] text-ink-3">Pick a date to see collections.</p>
      ) : loadError ? (
        <div className="rounded-card border border-line bg-paper p-3.5">
          <p className="text-[13px] text-ink-3">
            Could not load collections for {scopeLabel}.
          </p>
          <button
            type="button"
            onClick={() => void load({ onDate, locationId })}
            className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
          >
            Retry
          </button>
        </div>
      ) : report === null ? (
        <p className="text-[13px] text-ink-3">
          Loading collections for {scopeLabel}…
        </p>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12px] font-medium text-ink-2">Cash count</p>
              {report.cashCount ? (
                <StatusBadge
                  tone={report.cashCount.needsReview ? "warn" : "good"}
                >
                  {report.cashCount.needsReview
                    ? "Closed · review pending"
                    : "Closed"}
                </StatusBadge>
              ) : null}
            </div>

            {report.cashCount ? (
              <>
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

                {canReopen ? (
                  reopenOpen ? (
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      <label className="block grow">
                        <span className="mb-0.5 block text-[11px] text-ink-3">
                          Reason for reopening (required)
                        </span>
                        <input
                          value={reopenReason}
                          disabled={busy}
                          onChange={(e) => setReopenReason(e.target.value)}
                          className={`${inputClass} w-full`}
                          placeholder="Reason for reopening"
                        />
                      </label>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={reopenCount}
                      >
                        {busy ? "Reopening…" : "Confirm reopen"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setReopenOpen(false);
                          setReopenReason("");
                          setMessage(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="secondary"
                      className="mt-2"
                      disabled={busy}
                      onClick={() => {
                        setReopenOpen(true);
                        setMessage(null);
                      }}
                    >
                      Reopen
                    </Button>
                  )
                ) : (
                  <p className="mt-2 text-[12px] text-ink-3">
                    Ask the owner to reopen a closed count.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1.5 text-[12px] text-ink-3">
                  Not counted yet for {scopeLabel}.
                </p>

                {canConfirm ? (
                  <div className="mt-2">
                    <div className="flex flex-wrap items-end gap-2">
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
                          {varianceNeedsReason
                            ? "Reason (required)"
                            : "Reason (optional)"}
                        </span>
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          className={`${inputClass} w-full`}
                          placeholder={
                            varianceNeedsReason
                              ? "Why the cash differs"
                              : "Optional note"
                          }
                        />
                      </label>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={confirmCount}
                      >
                        {busy ? "Saving…" : `Confirm count for ${scopeLabel}`}
                      </Button>
                    </div>
                    <p className="mt-1.5 text-[12px] text-ink-3">
                      {varianceNeedsOwner
                        ? "Variance is over ₹2,000 — only the owner or an admin can close this count."
                        : varianceNeedsReason
                          ? "Variance is over ₹500 — a reason is required."
                          : "A reason is required when the count differs from the system figure by over ₹500."}
                    </p>
                  </div>
                ) : null}
              </>
            )}

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
