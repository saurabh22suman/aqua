"use client";

import { usePathname } from "next/navigation";
import { findActiveHref, type NavItem } from "@/components/bottom-nav";

// Owner Lavender B — the header's "where am I" crumb.
//
// The approved board opens the workspace with a breadcrumb. This one is
// derived from the SAME navigation list the sidebar renders, so the
// crumb can never name a destination the caller may not open, and it
// can never disagree with the active sidebar row.
//
// It is a client component because the route is a client-side fact.
// `usePathname` is available during the server render of a client
// component, so the first paint already carries the right name — there
// is no hydration mismatch and no layout shift.
export function OwnerShellCrumb({
  items,
  workspaceLabel = "Workspace",
}: {
  items: NavItem[];
  workspaceLabel?: string;
}) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, items);
  const label = items.find((item) => item.href === activeHref)?.label ?? "Overview";

  return (
    <p
      data-testid="owner-shell-crumb"
      className="hidden min-w-0 flex-none items-center gap-2 text-[12.5px] text-ink-3 lg:flex"
    >
      <span>{workspaceLabel}</span>
      <span aria-hidden="true" className="text-ink-3">
        /
      </span>
      <strong className="truncate font-medium text-ink-2">{label}</strong>
    </p>
  );
}
