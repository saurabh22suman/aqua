import { formatFullDateIST } from "@/lib/time/tz";
import type { ReactNode } from "react";

// Owner Home — the reference context header.
//
// The OpenPen owner workspace opens with the real day above the title,
// the club and the location the figures cover in the purpose line, and
// one small piece of club artwork in the action slot. Nothing here is
// invented: the date is the tenant's own day, the name is the academy's,
// and the location is the scope the figures were read under.
export function OwnerHomeHeader({
  scopeLabel,
  today,
}: {
  displayName: string;
  /** The location the figures cover, or "All locations". */
  scopeLabel: string | null;
  /** The tenant's own day (ISO date). */
  today: string;
  illustration?: ReactNode;
}) {
  return (
    <header data-testid="owner-home-context">
      <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome</h1>
      <p className="mt-1 text-xs text-ink-3">{formatFullDateIST(today)}{scopeLabel ? ` · ${scopeLabel}` : ""}</p>
    </header>
  );
}
