"use client";

// K-07 — the inline error for the café counter. Server refusals
// (a walk-in cannot be billed, a café bill must settle in full,
// a duplicate reference) are shown verbatim, never rewritten.

export function CafeErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-card border border-line bg-paper px-4 py-3 text-[13px] text-ink"
      data-testid="cafe-error"
    >
      {message}
    </p>
  );
}
