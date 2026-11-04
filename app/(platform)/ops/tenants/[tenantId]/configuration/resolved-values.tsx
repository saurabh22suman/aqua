import Link from "next/link";
import type { ResolvedConfig } from "@/db/config";
import { OpsCardFlush, OpsEmptyState } from "@/components/ops/ops-primitives";
import { OpsStatusPill } from "@/components/ops/ops-display";

// Ops redesign (28 October 2026) — the resolved-value rows.
//
// Each row is one configuration key: the key itself, the value the
// tenant resolves, where that value came from, and the "why this
// value?" link that opens the full resolution waterfall.
//
// The source detail (who set it, and when) stays on the row: "where
// did this come from" is the question the screen exists to answer.

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export function renderResolvedValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The scope a value was set at: the platform default, or a scope. */
function scopeLabel(config: ResolvedConfig): string {
  if (config.source.scopeType === "default") return "platform default";
  return config.source.scopeId
    ? `${config.source.scopeType}: ${config.source.scopeId}`
    : config.source.scopeType;
}

/** Who set it, and when — the part a scope pill cannot carry. */
function sourceDetail(config: ResolvedConfig): string | null {
  if (config.source.scopeType === "default") return null;
  const by = config.source.setBy ? `set by ${config.source.setBy.slice(0, 8)}` : null;
  const at = config.source.setAt
    ? `${DATETIME_FMT.format(new Date(config.source.setAt))} IST`
    : null;
  const parts = [by, at].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function SourcePill({ config }: { config: ResolvedConfig }) {
  return (
    <OpsStatusPill tone={config.source.scopeType === "default" ? "neutral" : "water"}>
      {scopeLabel(config)}
    </OpsStatusPill>
  );
}

export type ResolvedConfigRow = ResolvedConfig & {
  description: string;
  visibility: string;
  risk: string;
};

export function ResolvedValues({
  configs,
  selectedConfigKey,
  chainHref,
  children,
}: {
  configs: readonly ResolvedConfigRow[];
  selectedConfigKey: string | null;
  chainHref: (key: string) => string;
  /** The resolution waterfall for the selected key, if any. */
  children?: (configKey: string) => React.ReactNode;
}) {
  return (
    <OpsCardFlush>
      {configs.map((config) => {
        const detail = sourceDetail(config);
        return (
          <div
            key={config.key}
            className="border-b border-line px-4 py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-[13px] text-ink">{config.key}</span>
              <div className="flex flex-wrap items-center gap-2">
                <SourcePill config={config} />
                <Link
                  href={chainHref(config.key)}
                  className={`text-[11px] font-medium underline underline-offset-2 ${
                    selectedConfigKey === config.key
                      ? "text-marine"
                      : "text-[var(--accent-ink)]"
                  }`}
                >
                  Why this value?
                </Link>
              </div>
            </div>
            <p className="mt-1 text-[14px] font-medium text-ink">
              {renderResolvedValue(config.value)}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              {config.description} · {config.visibility} · {config.risk} risk
            </p>
            {detail ? (
              <p className="mt-0.5 text-[11px] text-ink-3">{detail}</p>
            ) : null}
            {selectedConfigKey === config.key && children ? (
              <div className="mt-3">{children(config.key)}</div>
            ) : null}
          </div>
        );
      })}
    </OpsCardFlush>
  );
}

export function LocationOverrides({
  rows,
}: {
  rows: readonly {
    location: { locationId: string; locationName: string; isPrimary: boolean };
    value: ResolvedConfig;
  }[];
}) {
  if (rows.length === 0) {
    return (
      <OpsEmptyState
        title="No location-scoped overrides"
        body="Every location resolves the same values as the tenant."
      />
    );
  }
  return (
    <OpsCardFlush>
      {rows.map(({ location, value }) => (
        <div
          key={`${location.locationId}-${value.key}`}
          className="border-b border-line px-4 py-3 last:border-b-0"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] text-ink">
              <span className="font-medium">{location.locationName}</span>
              {location.isPrimary ? " (primary)" : ""} ·{" "}
              <span className="font-mono">{value.key}</span>
            </span>
            <SourcePill config={value} />
          </div>
          <p className="mt-1 text-[14px] font-medium text-ink">
            {renderResolvedValue(value.value)}
          </p>
        </div>
      ))}
    </OpsCardFlush>
  );
}
