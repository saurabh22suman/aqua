"use client";

import { cn } from "./cn";

// UI foundation — Switch.
//
// A switch is for a setting that takes effect immediately ("send
// reminders on"). It is a button with role="switch" and aria-checked,
// because a checkbox would promise a form submit that never happens.
// The visible label is the accessible name — no duplicate aria-label.

export type SwitchProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function Switch({
  label,
  checked,
  onCheckedChange,
  disabled,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex min-h-11 items-center gap-3 text-left",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 flex-none rounded-pill border motion-fast transition-colors",
          checked
            ? "border-transparent bg-[var(--action-surface)]"
            : "border-line bg-deck",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow-1 motion-fast transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="text-[14px] text-ink-2">{label}</span>
    </button>
  );
}
