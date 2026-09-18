import type { ReactNode } from "react";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerSideNav } from "@/components/owner-side-nav";

// U-10 — owner desktop shell. At lg (≥1024px) the owner gets a
// sidebar + top bar; below lg the existing four-item BottomNav is
// preserved unchanged (same item list, passed in from the layout).
// Coach and reception never render this file: it is imported only by
// app/(owner)/layout.tsx, and route groups keep the bundles apart.
//
// The mobile header carries the same search box, so search is
// reachable on a phone without becoming a fifth nav item (DESIGN.md
// §2: exactly four).
//
// The desktop sidebar, top bar and mobile header all use design
// tokens only; interactive rows are ≥44px (DESIGN.md §2).
export function OwnerShell({
  navItems,
  locations,
  children,
}: {
  navItems: NavItem[];
  locations: { id: string; name: string }[];
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] lg:flex lg:pb-0">
      <aside
        data-testid="owner-sidebar"
        className="hidden lg:flex lg:w-60 lg:flex-none lg:flex-col lg:border-r lg:border-line lg:bg-paper"
      >
        <div className="border-b border-line px-5 py-6">
          <p className="font-display text-[17px] font-semibold text-marine">
            Aqua
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">Owner console</p>
        </div>
        <nav aria-label="Primary" className="flex-1 px-2 py-3">
          <OwnerSideNav items={navItems} />
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          data-testid="owner-top-bar"
          className="sticky top-0 z-30 border-b border-line bg-paper"
        >
          <div className="flex min-h-16 items-center gap-3 px-4 lg:px-8">
            <div className="min-w-0 flex-1 lg:max-w-md">
              <GlobalSearch />
            </div>
          </div>
        </header>

        {/* W1-6 — renders itself away for single-location tenants and
            keeps its existing `?facility=` behaviour; the desktop
            shell does not add a second switcher. */}
        <FacilitySwitcher locations={locations} />

        <div className="lg:px-8">{children}</div>
      </div>

      <div data-testid="owner-mobile-nav" className="lg:hidden">
        <BottomNav items={navItems} />
      </div>
    </div>
  );
}
