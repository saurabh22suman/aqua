"use client";
import { useEffect, useState, type ReactNode } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { usePathname } from "next/navigation";
import { scopedOwnerNavigationHref } from "@/components/owner-ui/owner-facility-navigation";
import { OwnerNavigationScope } from "@/components/owner-ui/owner-navigation-scope";
import { findActiveHref, type NavItem } from "@/components/bottom-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { ownerIconName } from "@/components/owner-ui/owner-navigation";
import { TransientDisclosure } from "@/components/ui/TransientDisclosure";
import { Dialog } from "@/components/ui/Dialog";
import type { OwnerSidebarGroup } from "@/lib/nav";

export type OwnerMobileNavPreset = "courtside" | "operations" | "legacy";

const COURTSIDE_PHONE_LABELS: Readonly<Record<string, string>> = {
  "/owner": "Today",
  "/owner/fees": "Fees",
};

function ownerNavLabel(item: NavItem, preset: OwnerMobileNavPreset): string {
  if (preset !== "legacy") return COURTSIDE_PHONE_LABELS[item.href] ?? item.label;
  if (item.href === "/owner/fees") return "Fees";
  if (item.href === "/owner/schedule") return "Calendar";
  return item.label;
}

// Presets order the destinations already offered by the Owner layout.
// The More disclosure keeps search, secondary links and sign-out.
export function OwnerMobileNav({
  navItems,
  sidebarGroups,
  search,
  preset = "legacy",
}: {
  navItems: NavItem[];
  sidebarGroups?: OwnerSidebarGroup[];
  search?: ReactNode;
  preset?: OwnerMobileNavPreset;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => setMoreOpen(false), [pathname]);
  const available = sidebarGroups ? sidebarGroups.flatMap(group => group.items) : navItems;
  const findItem = (href: string) =>
    available.find(item => item.href === href) ?? navItems.find(item => item.href === href);
  const scheduleHref = findItem("/owner/schedule") ? "/owner/schedule" : "/owner/sessions";
  const primaryHrefs = {
    courtside: ["/owner", "/owner/enquiries", scheduleHref, "/owner/members"],
    operations: ["/owner", scheduleHref, "/owner/members"],
    legacy: ["/owner", "/owner/members", "/owner/fees"],
  }[preset];
  const primary = primaryHrefs
    .map(findItem)
    .filter((item): item is NavItem => !!item);
  const more = available.filter(item => !primary.some(primaryItem => primaryItem.href === item.href));
  const active = findActiveHref(pathname, primary);
  const moreActive = findActiveHref(pathname, more);
  const useMoreSheet = preset === "operations" || (preset === "courtside" && pathname !== "/owner");
  const triggerClass = `flex min-h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 whitespace-nowrap text-[12px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${moreActive ? "font-medium text-[var(--accent-strong)] underline underline-offset-4" : "font-normal text-ink-2"}`;
  const triggerContent = <><span className={`grid h-8 w-12 place-items-center rounded-xl ${moreActive ? "bg-[var(--accent-soft)]" : ""}`}><OwnerIcon name="more" size={22} /></span><span>More</span>{moreActive ? <span className="sr-only">Current section</span> : null}</>;
  const moreGroups = (sidebarGroups ?? [{ label: "Workspace", items: more }])
    .map(group => ({ ...group, items: group.items.filter(item => more.some(entry => entry.href === item.href)) }))
    .filter(group => group.items.length > 0);
  return (
    <OwnerNavigationScope pathname={pathname}>{searchParams => <nav aria-label="Primary" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }} className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] shadow-2">
      {primary.map(item => {
        const isActive = active === item.href;
        return <Link key={item.href} href={scopedOwnerNavigationHref(item.href, pathname, searchParams)} aria-current={isActive ? "page" : undefined} className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 whitespace-nowrap text-[12px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${isActive ? "font-medium text-[var(--accent-strong)]" : "font-normal text-ink-2"}`}><span className={`grid h-8 w-12 place-items-center rounded-xl ${isActive ? "bg-[var(--accent-soft)]" : ""}`}><OwnerIcon name={ownerIconName(item)} size={22} /></span>{ownerNavLabel(item, preset)}</Link>;
      })}
      {useMoreSheet ? <>
        <button type="button" aria-label={moreActive ? "More, current section" : "More"} aria-haspopup="dialog" aria-expanded={moreOpen} className={triggerClass} onClick={() => setMoreOpen(true)}>{triggerContent}</button>
        <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="More tools" className="owner-more-sheet" swipeToClose>
          {search ? <div className="mb-4">{search}</div> : null}
          <div className="owner-more-groups">
            {moreGroups.map(group => (
              <section key={group.label} aria-label={group.label}>
                <h3>{group.label}</h3>
                <ul>
                  {group.items.map(item => (
                    <li key={item.href}>
                      <Link href={scopedOwnerNavigationHref(item.href, pathname, searchParams)} onClick={() => setMoreOpen(false)} aria-current={moreActive === item.href ? "page" : undefined}>
                        <span className="owner-more-icon"><OwnerIcon name={ownerIconName(item)} size={18} /></span>
                        <span>{ownerNavLabel(item, preset)}</span>
                        <OwnerIcon name="chevron" size={15} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <TenantSignOut className="mt-4" />
        </Dialog>
      </> : <TransientDisclosure
        className="relative"
        triggerClassName={triggerClass}
        trigger={triggerContent}
      >
        <div className="absolute bottom-full right-2 mb-2 max-h-[60dvh] w-64 overflow-y-auto rounded-card border border-line bg-paper p-3 shadow-2">
          {/* The phone's record search lives HERE, not in the header row:
              the header carries the club identity, the facility in scope
              and the account, and the search needs its own room. The
              desktop search stays in the header, so BOTH instances stay
              mounted and no query or result state is lost. */}
          {search ? <div className="mb-2">{search}</div> : null}
          {more.map(item => <Link key={item.href} href={scopedOwnerNavigationHref(item.href, pathname, searchParams)} aria-current={moreActive === item.href ? "page" : undefined} className={`flex min-h-11 items-center rounded-ctl px-3 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ${moreActive === item.href ? "bg-[var(--accent-soft)] font-semibold text-[var(--accent-ink)]" : "text-ink"}`}>{ownerNavLabel(item, preset)}</Link>)}
          <TenantSignOut className="mt-2" />
        </div>
      </TransientDisclosure>}
    </nav>}</OwnerNavigationScope>
  );
}
