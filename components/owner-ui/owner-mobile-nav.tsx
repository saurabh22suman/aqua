"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ICONS, findActiveHref, type NavItem } from "@/components/bottom-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import type { OwnerSidebarGroup } from "@/lib/nav";

export function OwnerMobileNav({ navItems, sidebarGroups }: { navItems: NavItem[]; sidebarGroups?: OwnerSidebarGroup[] }) {
  const pathname = usePathname();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const available = sidebarGroups ? sidebarGroups.flatMap(group => group.items) : navItems;
  const home = navItems.find(item => item.href === "/owner");
  const members = available.find(item => item.href === "/owner/members") ?? navItems.find(item => item.href === "/owner/members");
  const calendar = available.find(item => item.href === "/owner/schedule");
  const primary = [home, members, calendar].filter((item): item is NavItem => !!item);
  const more = available.filter(item => !primary.some(primaryItem => primaryItem.href === item.href));
  const active = findActiveHref(pathname, primary);
  const moreActive = findActiveHref(pathname, more);
  const close = (restoreFocus = false) => {
    if (detailsRef.current) detailsRef.current.open = false;
    if (restoreFocus) triggerRef.current?.focus();
  };
  return (
    <nav aria-label="Primary" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }} className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] shadow-2">
      {primary.map(item => {
        const Icon = ICONS[item.iconName];
        return <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${active === item.href ? "text-[var(--accent-ink)] font-semibold" : "text-ink-2"}`}><Icon size={20} aria-hidden="true" />{item.href === "/owner/schedule" ? "Calendar" : item.label}</Link>;
      })}
      <details ref={detailsRef} className="relative" onKeyDown={(event) => { if (event.key === "Escape" && detailsRef.current?.open) { event.preventDefault(); close(true); } }}>
        <summary ref={triggerRef} className={`flex min-h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 text-[11px] focus-visible:outline-solid focus-visible:outline-2 ${moreActive ? "font-semibold text-[var(--accent-ink)] underline underline-offset-4" : "font-medium text-ink-2"}`}><span aria-hidden="true" className="text-xl leading-none">•••</span><span>More</span>{moreActive ? <span className="sr-only">Current section</span> : null}</summary>
        <div className="absolute bottom-full right-2 mb-2 max-h-[60dvh] w-64 overflow-y-auto rounded-card border border-line bg-paper p-3 shadow-2">
          {more.map(item => <Link key={item.href} href={item.href} onClick={() => close(true)} aria-current={moreActive === item.href ? "page" : undefined} className={`flex min-h-11 items-center rounded-ctl px-3 text-sm ${moreActive === item.href ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "text-ink"}`}>{item.label}</Link>)}
          <TenantSignOut className="mt-2" />
        </div>
      </details>
    </nav>
  );
}
