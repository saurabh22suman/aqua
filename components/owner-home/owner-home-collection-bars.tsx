"use client";

import { useState } from "react";
import { formatINR } from "@/lib/money/format";
import type { CollectionsBucket } from "@/lib/services/owner-home-charts";

export function OwnerHomeCollectionBars({ buckets }: { buckets: readonly CollectionsBucket[] }) {
  const [selection, setSelection] = useState<string>();
  const current = buckets.find((bucket) => bucket.key === selection) ?? buckets.at(-1);
  if (!current) return null;

  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.totalPaise));
  return (
    <>
      <p className="courtside-trend-readout" aria-live="polite">
        <span>{current.fullLabel}</span>
        <strong>{formatINR(current.totalPaise)}</strong>
      </p>
      <div className="courtside-trend-chart" role="group" aria-label="Collections by period">
        {buckets.map((bucket) => (
          <button
            key={bucket.key}
            type="button"
            aria-pressed={bucket.key === current.key}
            aria-label={`${bucket.fullLabel}, ${formatINR(bucket.totalPaise)}`}
            onClick={() => setSelection(bucket.key)}
          >
            <span aria-hidden="true" className="courtside-trend-bar-track">
              <span style={{ height: `${Math.max(4, bucket.totalPaise / maximum * 96)}%` }} />
            </span>
            <span aria-hidden="true">{bucket.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
