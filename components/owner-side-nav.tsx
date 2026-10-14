"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ICONS, findActiveHref } from "@/components/bottom-nav";
import { OWNER_SIDEBAR_GROUPS, type OwnerSidebarGroup } from "@/lib/nav";

// U-10 — owner desktop sidebar, grouped (W1-6 continuation). Same
// active-state resolution as the mobile BottomNav (findActiveHref),
// so the two navs can never disagree about where the owner is.
// 44px rows per DESIGN.md §2; active state uses the accent tokens the
// same way the bottom nav does. Group labels are small-caps eyebrows
// with spacing — no divider lines (visual weight without clarity).
//
// C01 — the owner layout passes a permission-filtered group list for
// the Accountant's finance-shaped frame; when no list is supplied
// (component tests, any future owner-only caller) the full contract
// renders unchanged.
export function OwnerSideNav({
  groups = OWNER_SIDEBAR_GROUPS,
}: {
  groups?: OwnerSidebarGroup[];
}) {
  const pathname = usePathname();
  const allItems = groups.flatMap((group) => group.items);
  const activeHref = findActiveHref(pathname, allItems);

  return (
    <div data-testid="owner-side-nav">
      {groups.map((group, index) => (
        <div key={group.label} className={index === 0 ? undefined : "mt-5"}>
          <p className="px-3 text-[11px] font-medium uppercase tracking-wider text-ink-3">
            {group.label}
          </p>
          <ul className="mt-1 space-y-1">
            {group.items.map((item) => {
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
        </div>
      ))}
    </div>
  );
}
