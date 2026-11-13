import { OpsPanel } from "@/components/ops/ops-primitives";
import { formatDateIST, formatTimeIST } from "@/lib/time/tz";
import {
  SNAPSHOT_STALE_AFTER_HOURS,
  type SnapshotFreshness,
} from "./snapshot-freshness";

// Ops reliability lane (9 November 2026) — the BOUNDED freshness notice.
//
// One region, under the page header and above the figures, that says
// what the snapshot is and when it was computed.
//
// It is a region and not the page: the figures stay on screen
// underneath it. A stale snapshot is FLAGGED, never hidden — the
// operator still needs the last known values.
//
// The wording says what this console can and cannot stand behind, and
// it never mentions a worker, a provider or a backup, because this
// console holds no evidence about any of them.

/**
 * The notice for a snapshot that is not current.
 *
 * It renders nothing for a fresh snapshot (a page that always warns is
 * as dishonest as one that never warns) and nothing for a missing one
 * (the page already says that the figures are unavailable).
 */
export function SnapshotFreshnessNotice({
  snapshot,
}: {
  snapshot: SnapshotFreshness;
}) {
  if (snapshot.kind === "missing" || snapshot.kind === "fresh") return null;

  if (snapshot.kind === "stale") {
    return (
      <OpsPanel
        tone="warn"
        role="status"
        className="mt-6"
        title="Snapshot out of date"
      >
        <p>
          This snapshot is out of date. Computed on {formatDateIST(snapshot.asOf)},{" "}
          {formatTimeIST(snapshot.asOf)} IST — more than{" "}
          {SNAPSHOT_STALE_AFTER_HOURS} hours ago, past the window this console uses for a
          daily snapshot. The figures below are the last known values, not the state of the
          platform right now. The needs-attention queue is live and does not depend on this
          snapshot.
        </p>
      </OpsPanel>
    );
  }

  if (snapshot.kind === "future") {
    return (
      <OpsPanel
        tone="error"
        role="alert"
        className="mt-6"
        title="Snapshot timestamp is in the future"
      >
        <p>
          The daily snapshot is dated {formatDateIST(snapshot.asOf)},{" "}
          {formatTimeIST(snapshot.asOf)} IST — later than the clock on this server — so
          the figures below cannot be trusted as current. They are the last values this
          console received. The needs-attention queue is live and does not depend on this
          snapshot.
        </p>
      </OpsPanel>
    );
  }

  return (
    <OpsPanel
      tone="error"
      role="alert"
      className="mt-6"
      title="Snapshot timestamp could not be read"
    >
      <p>
        The daily snapshot carries a timestamp this console could not read, so the
        figures below cannot be trusted as current. They are the last values this console
        received. The needs-attention queue is live and does not depend on this snapshot.
      </p>
    </OpsPanel>
  );
}
