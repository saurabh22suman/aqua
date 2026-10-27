import { formatFullDateIST } from "@/lib/time/tz";
import type { ReactNode } from "react";

// Owner Home — the header that opens the screen.
//
// The approved board opens with three real things and then the work:
// the day, the club, and the location the figures cover. Nothing here
// is decorative and nothing here is invented — the date is the
// tenant's own day, the name is the academy's, and the location is
// the scope the figures were read under.
//
// The heading says "Your club today" rather than a greeting: a greeting
// ("a good day for your club") asserts how the day is going, and the
// day may have three overdue payments in it.
export function OwnerHomeHeader({
  displayName,
  scopeLabel,
  today,
  illustration,
}: {
  displayName: string;
  /** The location the figures cover, or "All locations". */
  scopeLabel: string | null;
  /** The tenant's own day (ISO date). */
  today: string;
  illustration?: ReactNode;
}) {
  return (
    <header
      data-testid="owner-home-context"
      className="flex items-start justify-between gap-4"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
          {formatFullDateIST(today)}
        </p>
        <h1 className="mt-1.5 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">
          Your club today
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          {"Here’s how things are looking at "}
          <span className="font-medium text-ink-2">{displayName}</span>
          {scopeLabel ? ` · ${scopeLabel}` : ""}
        </p>
      </div>
      {illustration ? <div className="flex-none">{illustration}</div> : null}
    </header>
  );
}
