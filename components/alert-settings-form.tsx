"use client";

import { Button } from "@/components/ui/Button";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateAbsenceAlertThresholdAction } from "@/lib/actions/absence-alerts";
import { Input } from "@/components/ui/Input";

// R.8 — owner setting for the low-attendance alert threshold.
// Default 50%; the monthly alert also requires at least 4 recorded
// marks, so one missed session never fires it.
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
    <div className="rounded-card border border-line bg-paper p-3.5 space-y-2.5">
      <div>
        <label className="block text-[12px] text-ink-3 mb-1">
          Alert when monthly attendance is below (%)
        </label>
        <Input
          type="number"
          min={0}
          max={100}
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28 border text-[16px]"
          data-testid="alert-threshold"
          aria-label="Attendance alert threshold percent"
        />
      </div>
      <p className="text-[12px] text-ink-3">
        Needs at least 4 marked sessions this month, so a single miss
        never alerts. Three consecutive absences always alert.
      </p>
      <Button
          variant="primary"
          size="md"
        type="button"
        onClick={save}
        disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
      {status === "saved" ? (
        <p className="text-[12px] text-ink-2">Saved.</p>
      ) : null}
      {status === "error" ? (
        <p className="text-[12px] text-ink-2">
          Threshold must be a whole number from 0 to 100.
        </p>
      ) : null}
    </div>
  );
}
