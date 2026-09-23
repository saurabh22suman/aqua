import { ProgressBar } from "./ProgressBar";

// PR3-C2 — plan runway. The member's subscription as a used/remaining
// strip with start and end dates; every value comes from real dates
// (no projected "days left" unless the caller computed it).
export function RunwayStrip({
  label,
  startLabel,
  endLabel,
  usedDays,
  totalDays,
  expired = false,
  testId = "runway-strip",
}: {
  label: string;
  startLabel: string;
  endLabel: string;
  usedDays: number;
  totalDays: number;
  expired?: boolean;
  testId?: string;
}) {
  const remaining = Math.max(0, totalDays - usedDays);
  return (
    <div className="rounded-ctl border border-line bg-paper px-3.5 py-3" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[12px] tabular-nums text-ink-3">
          {expired ? "Ended" : `${remaining} of ${totalDays} days left`}
        </p>
      </div>
      <div className="mt-2">
        <ProgressBar
          value={usedDays}
          max={totalDays}
          tone={expired ? "late" : usedDays / Math.max(1, totalDays) > 0.8 ? "warn" : "water"}
          label={`${label} runway`}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-ink-3">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
