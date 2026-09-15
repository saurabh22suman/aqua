import Link from "next/link";

// PR4 (ops console improvements) — shared display primitives used
// across the tenant-detail tabs, extracted when the single-scroll
// page split into Overview / Configuration / Entitlements / Locations
// / Messaging / Audit routes.

export const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3">
      <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>
      ) : null}
    </div>
  );
}

export function DescriptionRow({
  label,
  value,
  mono,
  href,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
}) {
  return (
    <div className="grid grid-cols-3 px-4 py-3 border-b border-line last:border-b-0">
      <p className="text-[13px] text-ink-3">{label}</p>
      <div className="col-span-2">
        {href ? (
          <Link
            href={href}
            className={`text-[14px] text-ink hover:underline underline-offset-2 ${mono ? "font-mono" : ""}`}
          >
            {value}
          </Link>
        ) : (
          <p className={`text-[14px] text-ink ${mono ? "font-mono" : ""}`}>
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-paper border border-line px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.10em] text-ink-3">
        {label}
      </p>
      <p className="mt-2 font-display text-[28px] font-semibold text-marine tabular-nums">
        {value}
      </p>
    </div>
  );
}

// Renders the structured detail JSON written by the platform-side
// service actions. The audit row carries enough to answer "why did
// this happen" without re-opening the row — show the reason if there
// is one, then any before/after diff. Falls back to the raw JSON for
// unknown action shapes so the timeline never silently drops detail.
export function ActivityDetail({ detail }: { detail: Record<string, unknown> }) {
  if (!detail || Object.keys(detail).length === 0) return null;

  const reason =
    typeof detail.reason === "string" && detail.reason.length > 0
      ? detail.reason
      : null;

  const fromTo =
    typeof detail.from === "string" && typeof detail.to === "string"
      ? `${detail.from} → ${detail.to}`
      : null;

  const before =
    detail.before && typeof detail.before === "object"
      ? (detail.before as Record<string, unknown>)
      : null;
  const after =
    detail.after && typeof detail.after === "object"
      ? (detail.after as Record<string, unknown>)
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
      {before && after ? (
        <p className="font-mono text-[11px] text-ink-3 break-all">
          {Object.keys(after)
            .map((k) => {
              const b = before[k];
              const a = after[k];
              return `${k}: ${String(b)} → ${String(a)}`;
            })
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
