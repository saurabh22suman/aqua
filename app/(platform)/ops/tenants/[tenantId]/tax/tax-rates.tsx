"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTenantTaxRateAction } from "@/lib/actions/platform-tax";
import {
  formatBasisPointsAsPercent,
  parsePercentToBasisPoints,
} from "@/lib/tax";
import type { TaxScopeRow } from "@/lib/services/tax";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OpsCardFlush, OpsEmptyState, OpsSection } from "@/components/ops/ops-primitives";
import { OpsWriteGate } from "@/components/ops/ops-display";

// GST rates per tenant / facility / activity. Money semantics:
// ops-only. Each row shows the resolved rate and where it came from,
// and edits the rate at its own scope.

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
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            aria-label={`GST percent for ${row.label}`}
            className="w-24"
          />
          <span className="text-[12px] text-ink-3">%</span>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => {
              const rateBp = parsePercentToBasisPoints(value);
              if (rateBp === null) return;
              onRun(row, rateBp);
            }}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
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
  canWrite,
}: {
  tenantId: string;
  config: { tenant: TaxScopeRow; locations: TaxScopeRow[]; activities: TaxScopeRow[] };
  /** Resolved on the server from the session role. */
  canWrite: boolean;
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
    <OpsWriteGate
      canWrite={canWrite}
      note={
        <>
          Read-only: this account can browse, not change, platform data. An
          administrator sets the GST rate.
        </>
      }
    >
      <div className="space-y-6">
        <OpsCardFlush>
          <RateRow {...rowProps(config.tenant)} />
        </OpsCardFlush>

        <OpsSection title="Per facility">
          {config.locations.length === 0 ? (
            <OpsEmptyState title="No facilities" />
          ) : (
            <OpsCardFlush>
              {config.locations.map((row) => (
                <RateRow key={row.scopeId} {...rowProps(row)} />
              ))}
            </OpsCardFlush>
          )}
        </OpsSection>

        <OpsSection title="Per activity">
          {config.activities.length === 0 ? (
            <OpsEmptyState title="No activities yet" />
          ) : (
            <OpsCardFlush>
              {config.activities.map((row) => (
                <RateRow key={row.scopeId} {...rowProps(row)} />
              ))}
            </OpsCardFlush>
          )}
        </OpsSection>
      </div>
    </OpsWriteGate>
  );
}
