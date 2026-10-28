import type { PlatformActivityRow } from "@/db/platform-activity";
import { OpsEmptyState } from "@/components/ops/ops-primitives";

// Ops redesign (28 October 2026) — the activity list.
//
// One card per event, so the detail envelope is legible inline rather
// than hidden behind a hover. The action key is the row's dominant
// element; the reason and the before/after diff live in the envelope
// below it, the same shape the tenant detail page's recentActivity
// uses.

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function OpsActivityList({ rows }: { rows: PlatformActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <OpsEmptyState
        title="No events match these filters"
        body="Widen the action, tenant or date filter — nothing has happened for this tenant in that window."
      />
    );
  }
  return (
    <ul className="overflow-hidden rounded-card border border-line bg-paper">
      {rows.map((r) => (
        <li key={r.id} className="border-b border-line px-4 py-3 last:border-b-0">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-mono text-[14px] text-ink">{r.action}</p>
            <p className="text-[12px] text-ink-3">{DATE_FMT.format(r.createdAt)}</p>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {r.tenantName ? (
              <span>
                on{" "}
                <span className="font-medium text-ink-2">{r.tenantName}</span>
                {r.tenantSlug ? <span className="font-mono"> ({r.tenantSlug})</span> : null}
              </span>
            ) : (
              <span>platform-side (no tenant)</span>
            )}
            {r.actorId ? <span className="ml-2">actor {r.actorId.slice(0, 8)}…</span> : null}
          </p>
          <DetailBlock detail={r.detail} />
        </li>
      ))}
    </ul>
  );
}

function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
  if (Object.keys(detail).length === 0) return null;
  const reason =
    typeof detail.reason === "string" && detail.reason.length > 0
      ? detail.reason
      : null;
  const fromTo =
    typeof detail.from === "string" && typeof detail.to === "string"
      ? `${detail.from} → ${detail.to}`
      : null;

  return (
    <div className="mt-1.5 space-y-1 text-[12px] text-ink-2">
      {reason ? (
        <p>
          <span className="text-ink-3">Reason:</span> {reason}
        </p>
      ) : null}
      {fromTo ? (
        <p>
          <span className="text-ink-3">Status:</span> {fromTo}
        </p>
      ) : null}
    </div>
  );
}
