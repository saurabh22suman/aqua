"use client";

import { useRef, useState } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRWhole } from "@/lib/money/format";
import type { OwnerBriefDay } from "@/lib/services/owner-home-brief";

// Owner Home — the one collections readout behind "View collections".
//
// A native <dialog> keeps focus management, Escape and the backdrop without a
// sheet library. The chart is proportional and every day is a real button with
// a spoken date + whole-rupee amount. No number animation: the selected value
// changes once, at the tap/keyboard boundary. A visually hidden table repeats
// the same values for screen readers that prefer a list over the bar group.

export function OwnerBriefCollections({
  days,
  periodLabel,
  scopeLabel,
  todayIso,
}: {
  days: OwnerBriefDay[];
  periodLabel: string;
  scopeLabel: string;
  todayIso: string;
}) {
  const sheet = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(
    days.find((day) => day.key === todayIso)?.key ?? days.at(-1)?.key,
  );
  const current = days.find((day) => day.key === selected) ?? days.at(-1);
  if (days.length === 0) return null;
  const max = Math.max(1, ...days.map((day) => day.paise));

  return (
    <>
      <button
        type="button"
        className="brief-quiet"
        onClick={() => sheet.current?.showModal()}
      >
        View collections <OwnerIcon name="chevron" size={14} />
      </button>
      <dialog
        ref={sheet}
        className="brief-sheet brief-collections"
        aria-labelledby="brief-collections-title"
        onClick={(event) => {
          if (event.target === sheet.current) sheet.current?.close();
        }}
      >
        <header className="brief-sheet-head">
          <div>
            <span className="brief-grip" aria-hidden="true" />
            <h2 id="brief-collections-title">Collections</h2>
          </div>
          <button
            type="button"
            className="brief-icon-button"
            aria-label="Close collections"
            onClick={() => sheet.current?.close()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="brief-sheet-body">
          <p className="brief-sheet-copy">
            {scopeLabel} · {periodLabel}. Gross captured payments recorded up to
            now — not revenue, and not cash at bank.
          </p>
          <div
            className="brief-chart"
            role="group"
            aria-label="Recorded payments by day"
          >
            {days.map((day) => (
              <button
                key={day.key}
                type="button"
                aria-pressed={day.key === current?.key}
                aria-label={`${day.fullLabel}, ${formatINRWhole(day.paise)}`}
                onClick={() => setSelected(day.key)}
              >
                <span className="brief-chart-plot" aria-hidden="true">
                  <span
                    className="brief-chart-bar"
                    style={{ height: `${Math.max(4, (day.paise / max) * 94)}%` }}
                  />
                </span>
                <span aria-hidden="true">{day.shortLabel}</span>
              </button>
            ))}
          </div>
          <p className="brief-collection-selected" aria-live="polite">
            <span>{current?.fullLabel}</span>
            <strong>{formatINRWhole(current?.paise ?? 0)}</strong>
          </p>
          <table className="sr-only">
            <caption>Recorded payments by day, {periodLabel}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.key}>
                  <th scope="row">{day.fullLabel}</th>
                  <td>{formatINRWhole(day.paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </dialog>
    </>
  );
}
