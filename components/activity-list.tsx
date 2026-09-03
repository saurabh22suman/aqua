import type { PlatformActivityRow } from "@/db/platform-activity";

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// Phase 3.9 — platform activity list. One card per event so
// the JSON envelope is legible inline (rather than a
// truncate-and-hover pattern that hides state). A single
// dominant element per row: the action key. Reasons and
// before/after diff live in the detail envelope rendered
// below it, the same shape the tenant detail page's
// recentActivity uses.
export function ActivityList({ rows }: { rows: PlatformActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-card bg-paper border border-line px-5 py-10 text-center">
        <p className="text-[14px] font-medium">No events</p>
        <p className="mt-2 text-[12.5px] text-ink-3">
          Nothing has happened that matches the current filters — yet.
        </p>
      </div>
    );
  }
  return (
    <ul className="rounded-card bg-paper border border-line overflow-hidden" data-testid="activity-list">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3 border-b border-line last:border-b-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[14px] font-mono text-ink truncate">{r.action}</p>
            <p className="text-[12px] text-ink-3 flex-none">{DATE_FMT.format(r.createdAt)}</p>
          </div>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {r.tenantName ? (
              <span>
                on{" "}
                <span className="font-medium text-ink-2">
                  {r.tenantName}
                </span>
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
    <div className="mt-1.5 text-[12px] text-ink-2 space-y-1">
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
