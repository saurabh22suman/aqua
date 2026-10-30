"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { updateAbsenceAlertThresholdAction } from "@/lib/actions/absence-alerts";

// Owner OpenPen management lane (29 October 2026).
//
// Absence alerts: the fixed academy rule is stated as a rule, not a
// field. The owner edits ONE threshold, and the four-mark requirement is
// written beside it so a single missed session never reads as an alert.
export function AlertSettingsForm({
  initialThreshold,
}: {
  initialThreshold: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(initialThreshold));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [busy, setBusy] = useState(false);

  async function save() {
    const thresholdPct = Number(value);
    if (
      !Number.isInteger(thresholdPct) ||
      thresholdPct < 0 ||
      thresholdPct > 100
    ) {
      setStatus("error");
      return;
    }
    setBusy(true);
    setStatus("idle");
    try {
      const res = await updateAbsenceAlertThresholdAction({ thresholdPct });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-[700px] rounded-card border border-line bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3.5">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">
            Three consecutive absences
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            Fixed academy alert rule — always alerts.
          </p>
        </div>
        <span className="flex-none rounded-ctl bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-2">
          Fixed academy alert rule
        </span>
      </div>

      <div className="pt-4">
        <label className="block" htmlFor="alert-threshold">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Monthly attendance below (%)
          </span>
          <Input
            id="alert-threshold"
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-28"
            data-testid="alert-threshold"
          />
        </label>
        <p className="mt-2 text-[12px] text-ink-3">
          At least four marked sessions are required this month, so a single
          miss never alerts. Alerts appear once a week at most.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="md"
            type="button"
            onClick={save}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save threshold"}
          </Button>
          {status === "saved" ? (
            <p role="status" className="text-[12px] text-ink-2">
              Saved.
            </p>
          ) : null}
          {status === "error" ? (
            <p role="alert" className="text-[12px] text-ink-2">
              Threshold must be a whole number from 0 to 100.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
