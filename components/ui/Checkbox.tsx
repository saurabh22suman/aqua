import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

// UI foundation — Checkbox.
//
// A native checkbox, restyled but never re-implemented: the native
// control brings the platform's own hit area, keyboard behaviour and
// form participation for free. The label wraps the control so the
// whole row is the target (44px minimum on the label row).

export type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "type"
> & {
  /** Called with the new checked state. */
  onCheckedChange?: (checked: boolean) => void;
  children?: ReactNode;
};

export function Checkbox({
  className,
  onCheckedChange,
  children,
  ...rest
}: CheckboxProps) {
  return (
    <label className={cn("inline-flex min-h-11 items-center gap-2", className)}>
      <input
        type="checkbox"
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        className={cn(
          "h-5 w-5 flex-none rounded border border-line bg-paper accent-[var(--accent-strong)]",
          "motion-fast transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        )}
        {...rest}
      />
      {children ? <span className="text-[14px] text-ink-2">{children}</span> : null}
    </label>
  );
}
