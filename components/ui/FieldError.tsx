import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";

// Phase 1 (mobile UX plan v2) — per-field error, not a combined line.
// NN/g form guidance: the message sits next to the field and carries
// an icon as well as text; `role="alert"` announces it. Deliberately
// neutral (no `good`/`late`/`warn`): DESIGN.md §1.1 reserves those for
// money and attendance state, and the semantic-token reservation scan
// (tests/tier1/semantic-token-reservation.test.ts) is right to flag a
// form error as the classic misuse. The message text is the signal.

export type FieldErrorProps = {
  id?: string;
  children?: ReactNode;
};

export function FieldError({ id, children }: FieldErrorProps) {
  if (!children) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1 flex items-start gap-1 text-[12px] text-ink-2"
    >
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 flex-none text-ink-3" />
      <span>{children}</span>
    </p>
  );
}
