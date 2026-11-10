import { formatFullDateIST } from "@/lib/time/tz";
import { greetingFor } from "@/components/owner-home/greeting";
import type { ReactNode } from "react";

// Owner Home — the context header.
//
// The approved mock (evening reference, 3 November 2026) opens with a compact
// time-of-day greeting and the club's own day. The facility in scope is NOT
// repeated under the date: the header row's facility switcher already states
// it, and one fact keeps one owner. The greeting is computed, never invented —
// no personal name is available in the authorised Owner context.
export function OwnerHomeHeader({
  today,
}: {
  displayName: string;
  /**
   * The location the figures cover. Kept in the API (callers still pass
   * it) but NOT printed here: the header row's facility switcher already
   * states it, and one fact keeps one owner.
   */
  scopeLabel: string | null;
  /** The tenant's own day (ISO date). */
  today: string;
  illustration?: ReactNode;
}) {
  return (
    <header data-testid="owner-home-context">
      <h1 className="font-display text-2xl font-medium tracking-tight">{greetingFor()}</h1>
      <p className="mt-1 text-xs text-ink-3">{formatFullDateIST(today)}</p>
    </header>
  );
}
