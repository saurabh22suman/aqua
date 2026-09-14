"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTenantTaxRateAction } from "@/lib/actions/platform-tax";
import {
  formatBasisPointsAsPercent,
  parsePercentToBasisPoints,
} from "@/lib/tax";
import type { TaxScopeRow } from "@/lib/services/tax";

// GST rates per tenant / facility / activity. Money semantics:
// ops-only. Each row shows the resolved rate and where it came from,
// and edits the rate at its own scope.

const inputClass =
  "w-24 rounded-ctl border border-line bg-paper px-3 py-1.5 text-[14px] text-ink focus:border-[var(--accent)] focus:outline-none";

function scopeLabel(row: TaxScopeRow): string {
  if (row.source.scopeType === "default") return "platform default";
  return `set at ${row.source.scopeType}`;
}

function RateRow({
  row,
  pending,
  message,
  onRun,
}: {
  row: TaxScopeRow;
  pending: boolean;
  message: string | null;
  onRun: (
    row: TaxScopeRow,
    rateBp: number,
  ) => void;
}) {
  const [value, setValue] = useState(
    formatBasisPointsAsPercent(row.rateBp).replace("%", ""),
  );

  return (
    <div className="border-b border-line last:border-b-0 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-ink">
          {row.label}
          <span className="ml-2 text-[11px] text-ink-3">
            {formatBasisPointsAsPercent(row.rateBp)} · {scopeLabel(row)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            aria-label={`GST percent for ${row.label}`}
            className={inputClass}
          />
          <span className="text-[12px] text-ink-3">%</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const rateBp = parsePercentToBasisPoints(value);
              if (rateBp === null) return;
              onRun(row, rateBp);
            }}
            className="rounded-pill px-4 py-1.5 text-[12px] font-semibold text-paper bg-[var(--accent)] hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {message ? (
        <p role="status" className="mt-1 text-[11px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function TaxRates({
  tenantId,
  config,
}: {
  tenantId: string;
  config: { tenant: TaxScopeRow; locations: TaxScopeRow[]; activities: TaxScopeRow[] };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  function run(row: TaxScopeRow, rateBp: number) {
    const key = `${row.scopeType}:${row.scopeId ?? "tenant"}`;
    setPendingKey(key);
    setMessages((prev) => ({ ...prev, [key]: "" }));
    startTransition(async () => {
      const result = await setTenantTaxRateAction({
        tenantId,
        scopeType: row.scopeType,
        ...(row.scopeId ? { scopeId: row.scopeId } : {}),
        rateBp,
      });
      setMessages((prev) => ({
        ...prev,
        [key]: result.ok ? "Saved." : result.error,
      }));
      if (result.ok) router.refresh();
      setPendingKey(null);
    });
  }

  const rowProps = (row: TaxScopeRow) => {
    const key = `${row.scopeType}:${row.scopeId ?? "tenant"}`;
    return {
      row,
      pending: pending && pendingKey === key,
      message: messages[key] ?? null,
      onRun: run,
    };
  };

  return (
    <div className="space-y-6">
      <section className="rounded-card bg-paper border border-line overflow-hidden">
        <RateRow {...rowProps(config.tenant)} />
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Per facility
        </h2>
        {config.locations.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            No facilities.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {config.locations.map((row) => (
              <RateRow key={row.scopeId} {...rowProps(row)} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-ink-3 font-medium">
          Per activity
        </h2>
        {config.activities.length === 0 ? (
          <p className="mt-2 rounded-card bg-paper border border-line px-4 py-3 text-[13px] text-ink-3">
            No activities yet.
          </p>
        ) : (
          <div className="mt-2 rounded-card bg-paper border border-line overflow-hidden">
            {config.activities.map((row) => (
              <RateRow key={row.scopeId} {...rowProps(row)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
