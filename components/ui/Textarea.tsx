import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Textarea.
//
// Same metrics as Input (16px text, the shared control height) and a
// resizable box: a coach writing an absence note needs more than one
// line, and the page, not the control, decides how tall a form gets.
//
// Owner redesign (27 October 2026) — the standard control: the 10px
// control radius, 16px control text and the neutral entry border. The
// box itself stays taller than one line; the 48px height is a floor,
// not a cap.

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid ? true : undefined}
        className={cn(
          "min-h-24 w-full rounded-ctl border border-[var(--control-border)] bg-paper px-4 py-2 text-[16px] text-ink",
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
  },
);
