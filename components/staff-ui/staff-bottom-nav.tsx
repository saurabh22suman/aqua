"use client";

import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/components/bottom-nav";
import {
  OwnerIcon,
  type OwnerIconName,
} from "@/components/owner-ui/owner-icon";

// Staff navigation — role-only.
//
// The staff surfaces draw the approved OwnerIcon geometry at the mobile
// navigation size (22), with a 12px label and the accent as the selected
// colour. Destinations come from the role's own NavItem list. Active
// detection follows the shared rule (exact wins on a tie, otherwise the
// longest prefix) and honours a destination's DECLARED `activePrefixes`
// — the shared client module is not imported, so its whole icon registry
// stays out of the staff bundle; the rule is pinned by a test. Ops keeps
// the shared BottomNav (its mobile rendering is best-effort and outside
// this role's visual scope).

function findStaffActiveHref(pathname: string, items: NavItem[]): string | null {
  let best: { href: string; exact: boolean } | null = null;
  for (const item of items) {
    const exact = pathname === item.href;
    // An exact root matches ONLY its own route; a section destination
    // also matches its own children.
    const ownPrefix =
      !item.exact &&
      [item.href].some(
        (href) => pathname === href || pathname.startsWith(href + "/"),
      );
    // `activePrefixes` is the DECLARED exception: a child route whose
    // parent destination lives under a different URL prefix (the coach
    // register under /coach). It is honoured for an exact root too —
    // suppressing it there would make the field unusable, because the
    // root's own prefix matching is off by definition.
    const declaredPrefix = (item.activePrefixes ?? []).some(
      (href) => pathname === href || pathname.startsWith(href + "/"),
    );
    const matches = exact || ownPrefix || declaredPrefix;
    if (!matches) continue;
    const better =
      best === null ||
      (exact && !best.exact && item.href.length === best.href.length) ||
      item.href.length > best.href.length;
    if (better) best = { href: item.href, exact };
  }
  return best?.href ?? null;
}

const ICON_FOR_NAV: Record<string, OwnerIconName> = {
  "list-checks": "home",
  "calendar-days": "calendar",
  "calendar-range": "calendar",
  users: "members",
  "user-round": "staff",
  "user-plus": "userplus",
  "clipboard-list": "enquiry",
  "file-text": "reports",
  settings: "settings",
  "layout-dashboard": "home",
};

export function staffNavIcon(iconName: string): OwnerIconName {
  return ICON_FOR_NAV[iconName] ?? "more";
}

export function StaffBottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const activeHref = findStaffActiveHref(pathname, items);

  return (
    <nav
      aria-label="Primary"
      data-staff-bottom-nav
      className="fixed inset-x-0 bottom-0 z-10 grid min-h-16 border-t border-line bg-paper shadow-2"
      style={{
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {items.map((item) => {
        const isActive = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] ${
              isActive
                ? "font-medium text-[var(--accent-strong)]"
                : "font-normal text-ink-2"
            }`}
          >
            <OwnerIcon name={staffNavIcon(item.iconName)} size={22} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
