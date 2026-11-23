"use client";

import { useState } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { formatINRWhole } from "@/lib/money/format";
import { getOwnerHomeFacilityMoneyAction } from "@/lib/actions/owner-home-brief";
import type { OwnerBriefFacilityMoney } from "@/lib/services/owner-home-brief";

// Owner Home — the deferred by-facility comparison.
//
// It exists only in the unscoped, multi-facility view. Opening the native
// disclosure asks the server for the caller's already-authorized sites; the
// action reuses the Fees overview's definitions, and a failure is a stated
// retry, never a zero. Activating a row hands the id back to Home's facility
// switch, so the same committed-scope and retry rules apply.

export function OwnerBriefFacilities({
  onSelect,
  disabled,
  facilityCount,
  facilityNoun,
}: {
  onSelect: (facilityId: string) => void;
  disabled: boolean;
  facilityCount: number;
  facilityNoun: string;
}) {
  const [rows, setRows] = useState<OwnerBriefFacilityMoney[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    if (loading || rows) return;
    setLoading(true);
    setFailed(false);
    try {
      setRows(await getOwnerHomeFacilityMoneyAction());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="brief-block brief-facilities" aria-label="Facility breakdown">
      <details
        onToggle={(event) => {
          const next = event.currentTarget.open;
          setOpen(next);
          if (next) void load();
        }}
      >
        <summary className="brief-row brief-facilities-toggle">
          <span className="brief-row-icon" aria-hidden="true">
            <OwnerIcon name="pin" size={17} />
          </span>
          <span className="brief-row-copy">
            <strong>By {facilityNoun}</strong>
            <span className="brief-secondary">{facilityCount} facilities</span>
          </span>
          <span className={`brief-tail${open ? " is-open" : ""}`}>
            <OwnerIcon name="down" size={15} />
          </span>
        </summary>
        <div className="brief-facility-list">
          {loading ? <p className="brief-muted">Loading facilities…</p> : null}
          {failed ? (
            <p className="brief-muted">
              Facility totals could not be loaded.{" "}
              <button type="button" className="brief-quiet" onClick={() => void load()}>
                Retry
              </button>
            </p>
          ) : null}
          {rows?.map((row) => (
            <button
              key={row.id}
              type="button"
              className="brief-row"
              disabled={disabled}
              onClick={() => onSelect(row.id)}
            >
              <span className="brief-row-copy">
                <strong>{row.name}</strong>
                <span className="brief-secondary">
                  {formatINRWhole(row.recordedPaise)} recorded · Last 7 days
                </span>
              </span>
              <span className="brief-site-money">
                {formatINRWhole(row.outstandingPaise)}
                <span>Outstanding</span>
              </span>
              <OwnerIcon name="chevron" size={14} />
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
