"use client";

import { usePathname } from "next/navigation";
import { findActiveHref } from "@/components/bottom-nav";
import {
  opsNavGroupsForRole,
  opsNavTargetFor,
  type OpsNavigationRole,
} from "@/components/ops/ops-nav-items";

// Ops completion (9 November 2026) — the shared context.
//
// ONE thin line that tells the operator where they are: the task area
// they are inside and the destination inside it.
//
// It is rendered ONCE, by the shell, above the page body — never by a
// page and never inside the rail — so two places can never show two
// different answers. It resolves the current destination with the SAME
// registry and the SAME resolver the rail uses
// (components/bottom-nav.tsx's findActiveHref over the Ops
// destinations), so the context and the rail can never disagree.
//
// It is deliberately THIN. The page already carries its own title, so
// the context carries only the location: the task area, and the
// destination inside it. When the task area and the destination share
// a name — the Overview is both — one word is enough and the second
// copy is dropped rather than repeated.
//
// It is not a breadcrumb and it is not a page title: it is a location
// line. It stays in flow (not sticky) so it can never fight the phone
// header or the demo-banner offset for the same sticky position; the
// rail is the console's persistent location cue.

export function OpsContextBar({
  role = "viewer",
}: {
  role?: OpsNavigationRole;
}) {
  const pathname = usePathname();
  const groups = opsNavGroupsForRole(role);

  // The role's own destinations only: a viewer has no Recovery row in
  // the rail, so a viewer has no Recovery context either.
  const resolution = groups.flatMap((group) =>
    group.items.map((item) => ({
      href: item.href,
      label: item.label,
      iconName: "briefcase" as const,
      exact: item.exact,
    })),
  );

  const activeHref = findActiveHref(pathname, resolution);
  const current = activeHref ? opsNavTargetFor(activeHref) : undefined;

  if (!current) return null;

  const { group, item } = current;
  const sameName = group.label === item.label;

  return (
    <div
      data-testid="ops-context"
      className="w-full px-5 pt-4 md:px-10"
    >
      <p className="mx-auto flex w-full max-w-[1080px] items-center gap-1.5 text-[12px] text-ink-3">
        {sameName ? null : (
          <>
            <span className="uppercase tracking-[0.12em]">{group.label}</span>
            <span aria-hidden="true">›</span>
          </>
        )}
        <span className="font-medium text-ink-2">{item.label}</span>
      </p>
    </div>
  );
}
