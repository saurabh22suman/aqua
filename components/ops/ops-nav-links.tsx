"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { findActiveHref } from "@/components/bottom-nav";
import { OPS_ICONS } from "./ops-icons";
import { OPS_NAV_ITEMS, OPS_ROUTE_RESOLUTION } from "./ops-nav-items";

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

export function OpsNavLinks({
  variant = "rail",
}: {
  variant?: "rail" | "menu";
}) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, [...OPS_ROUTE_RESOLUTION]);

  return (
    <ul className={variant === "rail" ? "space-y-1" : "space-y-1"}>
      {OPS_NAV_ITEMS.map((item) => {
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
  );
}
