"use client";
import type { ReactNode } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { usePathname } from "next/navigation";
import { findActiveHref, type NavItem } from "@/components/bottom-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { ownerIconName } from "@/components/owner-ui/owner-navigation";
import { TransientDisclosure } from "@/components/ui/TransientDisclosure";
import type { OwnerSidebarGroup } from "@/lib/nav";

/**
 * The phone label for one destination: short and consistent.
 *
 * "Fees & payments" is the desktop sidebar's full label; the phone bar
 * says "Fees". The schedule destination is named "Calendar" wherever the
 * phone shows it. Every other destination keeps its own label.
 */
function ownerNavLabel(item: NavItem): string {
  if (item.href === "/owner/fees") return "Fees";
  if (item.href === "/owner/schedule") return "Calendar";
  return item.label;
}

// Owner phone navigation.
//
// The PRIMARY BAR is the human-approved SECOND option (3 November 2026):
//
//   Home · Members · Fees · More
//
// Fees is the third destination — not Calendar. Calendar stays reachable
// from Home's open-calendar action and from the More panel, and every
// permitted destination stays reachable. The destinations still come from
// the already-filtered `available` source (the same one the desktop
// sidebar renders): a role without the Fees permission simply gets the
// remaining permitted destinations — no destination is ever injected —
// and optional modules (Bookings, Café) never shuffle the primary three.
//
// This pass changes the primary bar only. The More panel keeps its current
// transient list and its mounted search; a grouped sheet is not invented
// here. The permission filtering, the More menu, the `findActiveHref`
// resolution, the transient dismissal, the search draft, the safe area and
// the shell's clearance are unchanged.
//
// What the approved mock changed (Owner light, 2 November 2026):
//
//   - the glyphs are the mock's own outline geometry (a house for Home,
//     a plain calendar, the circular dots for More) instead of the
//     Lucide grid and the text bullets;
//   - the resting label is 12px at weight 400 and the active label is
//     weight 500 in the theme's accent, so the navigation reads as
//     quieter than the page it belongs to;
//   - the icons are 22px, the mock's size.
//
// The height stays 64px (the mock's --nav-h), so the navigation itself
// does not move.
export function OwnerMobileNav({ navItems, sidebarGroups, search }: { navItems: NavItem[]; sidebarGroups?: OwnerSidebarGroup[]; search?: ReactNode }) {
  const pathname = usePathname();
  const available = sidebarGroups ? sidebarGroups.flatMap(group => group.items) : navItems;
  const home = navItems.find(item => item.href === "/owner");
  const members = available.find(item => item.href === "/owner/members") ?? navItems.find(item => item.href === "/owner/members");
  // The approved third destination. The item comes from the filtered
  // source, so an owner without Fees never gets a Fees tab.
  const fees = available.find(item => item.href === "/owner/fees");
  const primary = [home, members, fees].filter((item): item is NavItem => !!item);
  const more = available.filter(item => !primary.some(primaryItem => primaryItem.href === item.href));
  const active = findActiveHref(pathname, primary);
  const moreActive = findActiveHref(pathname, more);
  return (
    <nav aria-label="Primary" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }} className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] shadow-2">
      {primary.map(item => {
        const isActive = active === item.href;
        return <Link key={item.href} href={item.href} aria-current={isActive ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] ${isActive ? "font-medium text-[var(--accent-strong)]" : "font-normal text-ink-2"}`}><OwnerIcon name={ownerIconName(item)} size={22} />{ownerNavLabel(item)}</Link>;
      })}
      <TransientDisclosure
        className="relative"
        triggerClassName={`flex min-h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 text-[12px] focus-visible:outline-solid focus-visible:outline-2 ${moreActive ? "font-medium text-[var(--accent-strong)] underline underline-offset-4" : "font-normal text-ink-2"}`}
        trigger={<><OwnerIcon name="more" size={22} /><span>More</span>{moreActive ? <span className="sr-only">Current section</span> : null}</>}
      >
        <div className="absolute bottom-full right-2 mb-2 max-h-[60dvh] w-64 overflow-y-auto rounded-card border border-line bg-paper p-3 shadow-2">
          {/* The phone's record search lives HERE, not in the header row:
              the header carries the club identity, the facility in scope
              and the account, and the search needs its own room. The
              desktop search stays in the header, so BOTH instances stay
              mounted and no query or result state is lost. */}
          {search ? <div className="mb-2">{search}</div> : null}
          {more.map(item => <Link key={item.href} href={item.href} aria-current={moreActive === item.href ? "page" : undefined} className={`flex min-h-11 items-center rounded-ctl px-3 text-sm ${moreActive === item.href ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "text-ink"}`}>{ownerNavLabel(item)}</Link>)}
          <TenantSignOut className="mt-2" />
        </div>
      </TransientDisclosure>
    </nav>
  );
}
