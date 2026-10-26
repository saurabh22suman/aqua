import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Select.
//
// A native <select>: it is the best choice for a short, known list of
// options on a phone (the platform picker, no custom listbox to get
// wrong), and it keeps the browser's own keyboard and screen reader
// behaviour. The chevron is decorative — the native control keeps its
// own affordance.

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <div className="relative block">
      <select
        className={cn(
          "min-h-11 w-full appearance-none rounded-ctl border border-line bg-paper py-2 pl-3 pr-9 text-[16px] text-ink",
          "motion-fast transition-colors",
          "focus:border-[var(--accent-strong)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        strokeWidth={1.8}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
      />
    </div>
  );
}
