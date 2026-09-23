"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ICONS,
  findActiveHref,
  type NavItem,
} from "@/components/bottom-nav";
import { OWNER_SIDEBAR_EXTRA_NAV } from "@/lib/nav";

// U-10 — owner desktop sidebar. Same item list and active-state
// resolution as the mobile BottomNav (both read TENANT_SURFACE_NAV
// .owner through the layout), so the two navs can never drift.
// 44px rows per DESIGN.md §2; active state uses the accent tokens
// the same way the bottom nav does.
export function OwnerSideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const allItems = [...items, ...OWNER_SIDEBAR_EXTRA_NAV];
  const activeHref = findActiveHref(pathname, allItems);

  return (
    <ul data-testid="owner-side-nav" className="space-y-1">
      {allItems.map((item) => {
        const Icon = ICONS[item.iconName];
        const isActive = item.href === activeHref;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-ctl px-3 text-[14px] font-medium transition-colors duration-150 ${
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                  : "text-ink-2 hover:bg-deck"
              }`}
            >
              <Icon
                size={18}
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
