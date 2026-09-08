"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListChecks,
  Settings,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

// Icon-name registry. Server components can't ship icon
// components (forwardRef objects) through the RSC boundary to a
// client component, so the layouts pass strings and the client
// looks them up. Adding a nav item means adding the icon import
// here AND a name entry; missing-from-map fails fast in dev.
const ICONS: Record<string, LucideIcon> = {
  "calendar-days": CalendarDays,
  "clipboard-list": ClipboardList,
  "file-text": FileText,
  "layout-dashboard": LayoutDashboard,
  "list-checks": ListChecks,
  "settings": Settings,
  "user-plus": UserPlus,
  "user-round": UserRound,
  "users": Users,
};

export type NavItem = {
  href: string;
  label: string;
  iconName: keyof typeof ICONS;
};

// Active-state detection: longest-prefix-wins, with an exact match
// preferred when both apply. /owner/members/[id] lights "Members",
// not "Home", even though /owner is a prefix; /owner/programs (which
// is not in the nav) lights "Home" because the nav doesn't know
// about it and the longer candidate doesn't exist. /login,
// /platform/login and other paths outside the nav surface render no
// active item.
function findActiveHref(pathname: string, items: NavItem[]): string | null {
  let best: { href: string; exact: boolean } | null = null;
  for (const item of items) {
    const exact = pathname === item.href;
    const prefix = exact || pathname.startsWith(item.href + "/");
    if (!prefix) continue;
    const better =
      best === null ||
      // Prefer exact match when lengths tie (catches /coach vs /coach/me).
      (exact && !best.exact && item.href.length === best.href.length) ||
      // Prefer longer match in general.
      item.href.length > best.href.length;
    if (better) best = { href: item.href, exact };
  }
  return best?.href ?? null;
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeHref = findActiveHref(pathname, items);

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 inset-x-0 h-16 bg-paper border-t border-line shadow-2 grid"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const Icon = ICONS[item.iconName];
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium ${
              isActive ? "text-[var(--accent-ink)]" : "text-ink-3"
            }`}
          >
            <Icon
              size={20}
              strokeWidth={isActive ? 2.2 : 1.8}
              aria-hidden="true"
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
