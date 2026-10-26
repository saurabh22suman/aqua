import type { ReactNode } from "react";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerSideNav } from "@/components/owner-side-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { OwnerSidebarGroup } from "@/lib/nav";

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
// UI foundation — scroll ownership. The 26 October 2026 UI quality
// review recorded the defect this structure fixes: "Members scrolling
// removes sidebar contents from view. Source owner-shell.tsx renders an
// aside without sticky/viewport constraints."
//
//   - ONE vertical scroll owner: the document. The content column is
//     NOT a second scroller, so route navigation, browser Back and
//     anchor links keep the browser's own scroll behaviour (an inner
//     scroller would silently break the router's scroll-to-top).
//   - The sidebar is viewport-bound and sticky: it stays visible while
//     the page scrolls, and it never grows past the viewport.
//   - Only the navigation region scrolls inside the sidebar, so an
//     overflowing menu stays usable on a short screen while the
//     branding and the exit control stay reachable without scrolling.
//   - The header stays sticky, so the record search remains available
//     during long-page scrolling.
//
// The desktop sidebar, top bar and mobile header all use design
// tokens only; interactive rows are ≥44px (DESIGN.md §2).
export function OwnerShell({
  navItems,
  sidebarGroups,
  locations,
  children,
}: {
  navItems: NavItem[];
  // C01 — permission-filtered sidebar groups for the Accountant; when
  // omitted the sidebar renders the full OWNER_SIDEBAR_GROUPS contract.
  sidebarGroups?: OwnerSidebarGroup[];
  locations: { id: string; name: string }[];
  children: ReactNode;
}) {
  // R07 (2026-10-13 role-workflow audit) — the Settings destination is
  // gated on settings.manage, and it hosted the only sign-out. A role
  // without it (the Accountant) gets the shell-level sign-out instead,
  // so a session can always be ended.
  const hasSettingsDestination = navItems.some(
    (item) => item.href === "/owner/settings",
  );
  return (
    <div
      data-testid="owner-shell"
      // lg:items-start keeps the sticky sidebar at its own height
      // instead of stretching it to the full column, which is what
      // makes it stay put while the page scrolls.
      className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] lg:flex lg:items-start lg:pb-0"
    >
      <aside
        data-testid="owner-sidebar"
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-none lg:flex-col lg:overflow-hidden lg:border-r lg:border-line lg:bg-paper print:hidden"
      >
        <div className="flex-none border-b border-line px-5 py-6">
          <p className="font-display text-[17px] font-semibold text-marine">
            Aqua
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">Owner console</p>
        </div>
        {/* The only independent scroller in the shell: the navigation
            list. It keeps the <nav> landmark (the landmark and the
            scroll owner are the same element), and min-h-0 lets it
            shrink inside the flex column, so it scrolls instead of
            pushing the exit control off a short screen. */}
        <nav
          aria-label="Primary"
          data-testid="owner-side-nav-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3"
        >
          <OwnerSideNav groups={sidebarGroups} />
        </nav>
        {!hasSettingsDestination ? (
          <div className="flex-none border-t border-line px-3 py-3">
            <TenantSignOut className="mt-0" />
          </div>
        ) : null}
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
            <ThemeToggle />
          </div>
        </header>

        {/* W1-6 — renders itself away for single-location tenants and
            keeps its existing `?facility=` behaviour; the desktop
            shell does not add a second switcher. */}
        <div className="flex-none">
          <FacilitySwitcher locations={locations} />
        </div>

        <div data-testid="owner-content" className="lg:px-8">
          {/* Owner UX audit (2026-10-24): the desktop content ran the
              full width of whatever window the owner had, so a form
              stretched across the screen and a table's columns drifted
              apart. The content is now capped at 1280px and centred
              — the audit's 1120–1280px band. Forms cap further, on
              their own pages. */}
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </div>

        {!hasSettingsDestination ? (
          <div className="px-5 pb-4 lg:hidden">
            <TenantSignOut className="mt-4" />
          </div>
        ) : null}
      </div>

      <div data-testid="owner-mobile-nav" className="lg:hidden">
        <BottomNav items={navItems} />
      </div>
    </div>
  );
}
