"use client";

import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/Button";

// Ops redesign (28 October 2026) — the operator console's error
// boundary.
//
// The console had no error boundary of its own, so a read that failed
// — a validated filter rejecting a malformed id, a transient database
// error — rendered the framework's default failure page: no retry, no
// way back, and a raw failure message on screen.
//
// This boundary is SCOPED to the operator console. It:
//
//   - says what happened in GENERIC words. The error's message, its
//     digest and its stack are NOT rendered: a failed read can carry
//     a query, a value or an internal name, and none of that belongs
//     on an operator's screen. The detail goes to the server log,
//     where the operator's team can read it with the right context.
//   - offers a RETRY that re-runs the screen, so a transient failure
//     costs one click.
//   - offers a WAY OUT back to the Overview, so a failure never traps
//     the operator in a dead screen.
//
// The backend's own behaviour is untouched: a validated read still
// rejects a malformed id, and a missing record is still a 404.

export default function OpsErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
        Something went wrong
      </p>
      <h1 className="mt-2 font-display text-[28px] font-semibold leading-tight text-marine">
        This screen could not be loaded
      </h1>
      <p className="mt-2 max-w-[76ch] text-[15px] text-ink-2">
        The request did not complete. Nothing was changed. Try again, or go
        back to the overview and start from there.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link href="/ops" className={buttonClasses({ variant: "secondary" })}>
          Back to the overview
        </Link>
      </div>
      <p className="mt-6 text-[12px] text-ink-3">
        The failure was recorded on the server. If it keeps happening, tell
        the platform owner the time and the screen you were on.
      </p>
    </div>
  );
}
