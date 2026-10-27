import type { ReactNode } from "react";
import { ChevronRight, UserRound } from "lucide-react";
import Link from "next/link";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { ClubFooterArt } from "@/components/illustrations/club-footer-art";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerShellCrumb } from "@/components/owner-shell-crumb";
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
// Owner Lavender B (27 October 2026) — the approved shell:
//   - the sidebar carries the brand AND the club above the navigation,
//     and the account row plus the exit control below it, so all three
//     stay reachable when the navigation is taller than a short screen;
//   - the header is a compact sticky row (56px) with a breadcrumb, the
//     record search and the appearance control;
//   - a quiet piece of artwork closes the sidebar.
//
// The desktop sidebar, top bar and mobile header all use design
// tokens only; interactive rows are ≥44px (DESIGN.md §2).

/**
 * The account row's label. A label lookup, not a behaviour branch: the
 * row says which role is signed in and nothing else (it carries no
 * permission and no data scope).
 */
const ROLE_LABEL: Record<string, string> = {
  owner: "Club owner",
  admin: "Administrator",
  accountant: "Accountant",
};

export function ownerRoleLabel(roleKey: string | null | undefined): string {
  if (!roleKey) return "Account";
  return ROLE_LABEL[roleKey] ?? "Account";
}

export function OwnerShell({
  navItems,
  sidebarGroups,
  locations,
  clubName = null,
  clubInitials = null,
  accountLabel = "Account",
  children,
}: {
  navItems: NavItem[];
  // C01 — permission-filtered sidebar groups for the Accountant; when
  // omitted the sidebar renders the full OWNER_SIDEBAR_GROUPS contract.
  sidebarGroups?: OwnerSidebarGroup[];
  locations: { id: string; name: string }[];
  // The academy the workspace belongs to. Shown under the product
  // mark so the owner always knows which club the figures describe.
  clubName?: string | null;
  clubInitials?: string | null;
  // The signed-in role, as a label.
  accountLabel?: string;
  children: ReactNode;
}) {
  // R07 (2026-10-13 role-workflow audit) — the Settings destination is
  // gated on settings.manage, and it hosted the only sign-out. A role
  // without it (the Accountant) gets the shell-level sign-out instead,
  // so a session can always be ended.
  const hasSettingsDestination = navItems.some(
    (item) => item.href === "/owner/settings",
  );
  const crumbItems = sidebarGroups
    ? sidebarGroups.flatMap((group) => group.items)
    : navItems;

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
        // The sidebar is a PASTEL surface (batch 4), not a white
        // column: the mint direction paints it pale mint, the
        // lavender direction pale lilac. It stays a light surface in
        // both presets, so the ink tokens and the focus ring keep
        // their contrast on it.
        //
        // The sticky offset and height follow the app chrome that sits
        // above the shell (the demo banner publishes its height as
        // --app-sticky-offset). Without it the sidebar slides under
        // that chrome and its brand is clipped.
        style={{
          top: "var(--app-sticky-offset)",
          height: "calc(100dvh - var(--app-sticky-offset))",
        }}
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-none lg:flex-col lg:overflow-hidden lg:border-r lg:border-line lg:bg-sidebar print:hidden"
      >
        {/* The brand, above the navigation and outside its scroller:
            the product mark and the academy the workspace belongs to.
            The product name stays "Aqua" — the approved board used a
            working brand, and renaming the product is a coordinated
            decision outside this work (see the handoff). */}
        <div
          data-testid="owner-shell-brand"
          className="flex-none border-b border-line px-4 pb-4 pt-6"
        >
          <p className="px-1 font-display text-[19px] font-semibold leading-none text-[var(--accent-ink)]">
            Aqua
          </p>
          {clubName ? (
            <div className="mt-3 flex items-center gap-2.5 rounded-ctl border border-line bg-paper/70 px-2.5 py-2">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-[var(--selected-surface)] font-display text-[13px] font-semibold text-[var(--selected-ink)]"
              >
                {clubInitials || clubName.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {clubName}
                </span>
                <span className="block truncate text-[11px] text-ink-3">
                  Owner workspace
                </span>
              </span>
            </div>
          ) : null}
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

        {/* A quiet closing piece of artwork, then the account row and
            the exit control — both below the navigation scroller, so
            they stay reachable on a short screen. */}
        <div className="flex-none px-4 pt-3">
          <ClubFooterArt />
        </div>

        <div
          data-testid="owner-shell-account"
          className="flex-none border-t border-line px-3 py-3"
        >
          {hasSettingsDestination ? (
            <Link
              href="/owner/settings"
              className="flex min-h-11 items-center gap-2.5 rounded-ctl px-1.5 py-1.5 motion-fast transition-colors hover:bg-[var(--surface-nav-hover)]"
            >
              <span
                aria-hidden="true"
                className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--selected-surface)] text-[var(--selected-ink)]"
              >
                <UserRound size={16} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {accountLabel}
                </span>
                <span className="block truncate text-[11px] text-ink-3">
                  Account settings
                </span>
              </span>
              <ChevronRight size={16} className="flex-none text-ink-3" aria-hidden="true" />
            </Link>
          ) : (
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <span
                aria-hidden="true"
                className="grid h-8 w-8 flex-none place-items-center rounded-full bg-[var(--selected-surface)] text-[var(--selected-ink)]"
              >
                <UserRound size={16} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {accountLabel}
                </span>
                <span className="block truncate text-[11px] text-ink-3">Signed in</span>
              </span>
            </div>
          )}
          {!hasSettingsDestination ? (
            <TenantSignOut className="mt-2" />
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          data-testid="owner-top-bar"
          // Same offset as the sidebar: the app chrome above the shell
          // (the demo banner) must not slide under the sticky header.
          style={{ top: "var(--app-sticky-offset)" }}
          className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-line bg-paper px-4 lg:px-8"
        >
          <OwnerShellCrumb items={crumbItems} />
          <div className="min-w-0 flex-1 lg:max-w-md">
            <GlobalSearch />
          </div>
          <ThemeToggle />
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
