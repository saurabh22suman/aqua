import type { HTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Badge.
//
// A small neutral label. It is NOT the status pill: lifecycle state
// (paid, overdue, present, lapsed) belongs to
// components/ui/StatusBadge.tsx, which owns the tone maps and the
// semantic colour reservation. This badge carries no state, so it
// never wears a status colour.

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: "neutral" | "soft";
};

export function Badge({ className, variant = "neutral", ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill px-3 py-1 text-[11px] font-medium",
        variant === "neutral"
          ? "border border-line bg-paper text-ink-2"
          : "bg-deck text-ink-2",
        className,
      )}
      {...rest}
    />
  );
}
