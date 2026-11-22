import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Input.
//
// The metrics are the product's, not the browser's: 16px text (anything
// smaller makes iOS zoom on focus) and the shared control height
// (DESIGN.md §2 touch-target floor). The control never removes the
// focus ring — the global focus-visible rule in app/globals.css draws
// it, and the focus border colour is the action colour of the active
// preset.
//
// Owner redesign (27 October 2026) — the approved standard control:
// 48px tall (`--control-height-md`), the 10px control radius, 16px
// control text and one horizontal padding (16px). The border is the
// neutral ENTRY border (a hairline tinted with the theme), so a text
// field reads as a quiet place to type rather than a coloured block.
//
// A PICKER — a native date, time, month or week field — wears the very
// lightly tinted picker surface instead, so a choice is distinguishable
// from free text. The tint is a surface colour; the native affordance
// and the label carry the meaning, so colour is never the only cue.

/** The input types that CHOOSE a value rather than type one. */
const PICKER_TYPES = new Set([
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Marks the control invalid; pairs with a Field error message. */
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = "text", ...rest },
  ref,
) {
  const picker = PICKER_TYPES.has(type);
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        "min-h-12 w-full rounded-ctl border border-[var(--control-border)] px-4 py-2 text-[16px] text-ink",
        picker ? "bg-[var(--control-surface-picker)]" : "bg-paper",
        "placeholder:text-ink-3 motion-fast transition-colors",
        "hover:border-[var(--control-border-hover)]",
        "focus:border-[var(--accent-strong)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        invalid && "border-[var(--border-strong)]",
        className,
      )}
      {...rest}
    />
  );
});
