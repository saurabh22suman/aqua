import type { LabelHTMLAttributes } from "react";
import { cn } from "./cn";

// UI foundation — Label.
//
// A label is always a real <label htmlFor>, never a <span> that only
// looks like one: the association is what makes the control
// announceable and clickable. The required marker is shown visually
// AND announced, so "required" is never carried by an asterisk alone.

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  required?: boolean;
};

export function Label({ className, required, children, ...rest }: LabelProps) {
  return (
    <label
      className={cn("block text-[13px] font-medium text-ink-2", className)}
      {...rest}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-1 text-ink-3">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </label>
  );
}
