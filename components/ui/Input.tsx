import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Input.
//
// The metrics are the product's, not the browser's: 16px text (anything
// smaller makes iOS zoom on focus) and a 44px minimum height (the
// DESIGN.md §2 touch-target floor). The control never removes the
// focus ring — the global focus-visible rule in app/globals.css draws
// it, and the focus border colour is the action colour of the active
// preset.

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Marks the control invalid; pairs with a Field error message. */
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid ? true : undefined}
      className={cn(
        "min-h-11 w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink",
        "placeholder:text-ink-3 motion-fast transition-colors",
        "focus:border-[var(--accent-strong)]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        invalid && "border-[var(--border-strong)]",
        className,
      )}
      {...rest}
    />
  );
});
