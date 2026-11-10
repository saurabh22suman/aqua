import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

// Ops completion (9 November 2026) — the console's RECORD title.
//
// A section title is an h2 (components/ops/ops-primitives.tsx's
// OpsSection: small caps, muted). A record — a plan, a preset — is an
// h3.
//
// The console used the h2 level for both, in three different sizes:
// 20px for a plan name, 18px for a preset name, 16px for a panel
// title. A screen-reader user navigating by heading could not tell a
// section from a record, and a sighted user saw the same kind of thing
// in three different sizes.
//
// One treatment, one level, everywhere a record is named.
export function OpsRecordTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "font-display text-[16px] font-semibold text-ink",
        className,
      )}
    >
      {children}
    </h3>
  );
}
