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
  // Sub-PR 3: optional feature gate. When set, the nav item is
  // hidden when ctx.features does NOT contain this key — the
  // owner/reports tile hides when an operator has turned the
  // reports feature off, before the user can click through to
  // a 404 page. Architecture §7.3 says both layers: the action
  // gate is requirePermission(ctx, "reports.operational"), the UI
  // gate is this field. The matrix test exercises both.
  //
  // What the code actually does at render time: an item is shown
  // iff (a) it has no featureKey set, OR (b) its featureKey is
  // not in the hiddenFeatures array the layout passes down.
  // hiddenFeatures is ctx.features (a Set<string>) serialised to
  // an array — Next can't ship a Set across the RSC boundary, so
  // the server-component layout does the conversion. The filter
  // lives in the BottomNav client component below; see the
  // visibleItems computation.
  featureKey?: string;
};

export type BottomNavProps = {
  items: NavItem[];
  // Server components pass a Set, which Next.js can't serialise.
  // The layouts convert ctx.features (a Set<string>) into an
  // array before passing it down.
  hiddenFeatures?: string[];
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

export function BottomNav({ items, hiddenFeatures = [] }: BottomNavProps) {
  const pathname = usePathname();
  const hidden = new Set(hiddenFeatures);
  const visibleItems = items.filter((item) => !item.featureKey || !hidden.has(item.featureKey));
  const activeHref = findActiveHref(pathname, visibleItems);

  return (
    <nav
      aria-label="Primary"
      // min-h, not h: on notch phones the home-indicator inset adds
      // real height below the bar. Without it the nav sits on the
      // indicator and the lowest 10-20px of every tap target is dead.
      // Mobile pass [automatable]: static + emulator-verified; notch
      // overlap still needs a real-device check (see PR report).
      className="fixed bottom-0 inset-x-0 min-h-16 bg-paper border-t border-line shadow-2 grid"
      style={{
        gridTemplateColumns: `repeat(${visibleItems.length}, minmax(0, 1fr))`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {visibleItems.map((item) => {
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
