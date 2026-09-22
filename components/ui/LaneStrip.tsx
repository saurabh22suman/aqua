import type { ReactNode } from "react";
import { ProgressBar, type ProgressTone } from "./ProgressBar";

// PR3-C2 — the lane strip (DESIGN.md: "three reuses"): a time-led
// session row with a capacity meter. Owner home, coach Today and the
// reception check-ins all show the same shape; this is its single home.
export function LaneStrip({
  time,
  title,
  subtitle,
  started,
  ended,
  detail,
  trailing,
  tone = "water",
  icon,
  testId = "lane-strip",
}: {
  time: string;
  title: string;
  subtitle?: string;
  started: number;
  ended: number;
  /** Count rendered on the right; defaults to `ended/started`. */
  detail?: ReactNode;
  trailing?: string;
  tone?: ProgressTone;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="bg-paper border border-line rounded-card px-4 py-3.5"
      data-testid={testId}
    >
      <div className="flex justify-between items-baseline gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="font-display text-[15px] font-semibold flex items-center gap-1.5">
            {icon}
            {time} {title}
          </div>
          {subtitle ? (
            <div className="text-[12.5px] text-ink-3 mt-0.5 truncate">{subtitle}</div>
          ) : null}
          {trailing ? (
            <div className="text-[12px] text-ink-3 mt-0.5">{trailing}</div>
          ) : null}
        </div>
        <div className="font-display text-[15px] font-semibold flex-none">
          {detail ?? (
            <>
              {ended}
              <span className="text-ink-3 font-normal">/{started}</span>
            </>
          )}
        </div>
      </div>
      <ProgressBar
        value={ended}
        max={started}
        tone={tone}
        label={`${title} capacity`}
      />
    </div>
  );
}
