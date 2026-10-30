import { formatFullDateIST } from "@/lib/time/tz";
import { PageHeader } from "@/components/ui/PageHeader";
import type { ReactNode } from "react";

// Owner Home — the reference context header.
//
// The OpenPen owner workspace opens with the real day above the title,
// the club and the location the figures cover in the purpose line, and
// one small piece of club artwork in the action slot. Nothing here is
// invented: the date is the tenant's own day, the name is the academy's,
// and the location is the scope the figures were read under.
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
    <header data-testid="owner-home-context">
      <PageHeader
        title="Club overview"
        purpose={
          <>
            {formatFullDateIST(today)} ·{" "}
            <span className="font-medium text-ink-2">{displayName}</span>
            {scopeLabel ? ` · ${scopeLabel}` : ""}
          </>
        }
        action={illustration}
      />
    </header>
  );
}
