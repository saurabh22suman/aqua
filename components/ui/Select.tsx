import { forwardRef } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import type { SelectHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Select.
//
// A native <select>: it is the best choice for a short, known list of
// options on a phone (the platform picker, no custom listbox to get
// wrong), and it keeps the browser's own keyboard and screen reader
// behaviour. The chevron is decorative — the native control keeps its
// own affordance.
//
// Owner redesign (27 October 2026) — a select is a PICKER, so it wears
// the standard control metrics (48px, the 10px control radius, 16px
// control text, 16px horizontal padding) and the very lightly tinted
// picker surface, so a choice is distinguishable from a free-text field
// without colour being the only cue (the native affordance and the
// chevron carry it too).
//
// The REF is forwarded to the underlying `<select>`, not to the
// wrapper: an inline select (a control in a table row) has to be
// focusable and readable imperatively — the People lane's interface
// request R5. `forwardRef` also makes the public props type accept a
// `ref` at all, which a plain function component cannot.

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <div className="relative block">
        <select
          ref={ref}
          className={cn(
            "min-h-12 w-full appearance-none rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface-picker)] py-2 pl-4 pr-9 text-[16px] text-ink",
            "motion-fast transition-colors",
            "hover:border-[var(--control-border-hover)]",
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
  },
);
