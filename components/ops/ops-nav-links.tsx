"use client";

import Link from "next/link";
import { useId } from "react";
import { usePathname } from "next/navigation";
import { findActiveHref } from "@/components/bottom-nav";
import { OPS_ICONS } from "./ops-icons";
import {
  opsNavGroupsForRole,
  OPS_ROUTE_RESOLUTION,
  type OpsNavigationRole,
} from "./ops-nav-items";

// Ops redesign (28 October 2026) — the navigation rows.
//
// The active destination is resolved with the SHARED resolver
// (components/bottom-nav.tsx), the same one the tenant bottom bar
// uses, so the Ops rail, the Ops phone Menu and the Ops bottom bar can
// never disagree about which section the operator is in.
//
// The selected row is painted with the preset's own selection tokens
// (`--selected-surface` / `--selected-ink`) — a tinted surface, not a
// white card, and not a colour-only cue: the row also carries
// `aria-current="page"`, which is what a screen reader announces.
//
// Ops completion (9 November 2026) — the rows are GROUPED by task.
//
// A group is a labelled LIST: the visible label is a paragraph, and
// the list points at it with `aria-labelledby`, so a screen reader
// hears "Clubs and leads, list" and a sighted operator reads the same
// two words in the same place. The label is deliberately NOT a
// heading — the rail is navigation, and its labels must not appear in
// the page's heading outline.
//
// The group that owns the current destination carries
// `aria-current="true"`, so the operator can hear which task area they
// are in without reading the row itself. A role that may not see every
// destination of a group gets no group at all: there is no orphan
// label and no empty list.

export function OpsNavLinks({
  variant = "rail",
  role = "viewer",
}: {
  variant?: "rail" | "menu";
  role?: OpsNavigationRole;
}) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, [...OPS_ROUTE_RESOLUTION]);
  const groups = opsNavGroupsForRole(role);
  const idPrefix = useId();

  return (
    <>
      {groups.map((group) => {
        const labelId = `${idPrefix}-${group.id}`;
        const isCurrentGroup = group.items.some(
          (item) => item.href === activeHref,
        );
        return (
          <div
            key={group.id}
            className={variant === "rail" ? "mb-5 last:mb-0" : "mb-4 last:mb-0"}
          >
            <p
              id={labelId}
              className="px-3 pb-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-3"
            >
              {group.label}
            </p>
            <ul
              aria-labelledby={labelId}
              aria-current={isCurrentGroup ? "true" : undefined}
              className="space-y-1"
            >
              {group.items.map((item) => {
                const Icon = OPS_ICONS[item.icon];
                const isActive = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-2.5 rounded-ctl px-3 text-[14px] font-medium transition-colors duration-150 ${
                        isActive
                          ? "bg-[var(--selected-surface)] text-[var(--selected-ink)]"
                          : "text-ink-2 hover:bg-[var(--surface-nav-hover)] hover:text-ink"
                      }`}
                    >
                      <Icon
                        size={16}
                        strokeWidth={isActive ? 2.2 : 1.8}
                        aria-hidden="true"
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}
