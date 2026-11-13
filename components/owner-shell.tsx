import { Suspense, type ReactNode } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import type { NavItem } from "@/components/bottom-nav";
import { OwnerMobileNav } from "@/components/owner-ui/owner-mobile-nav";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerChromeOffset } from "@/components/owner-chrome-offset";
import { OwnerAccountControl } from "@/components/owner-home/owner-account-control";
import { OwnerShellCrumb } from "@/components/owner-shell-crumb";
import { OwnerSideNav } from "@/components/owner-side-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PersonAvatar } from "@/components/avatar";
import { ClubMark } from "@/components/branding/club-mark";
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
  manager: "Manager",
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
  clubLogoUrl = null,
  accountName = null,
  tenantId,
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
  clubLogoUrl?: string | null;
  // The signed-in person's display name. The shell's account controls
  // are PERSON controls: the account row in the sidebar and the account
  // control in the header draw this person's own initials through the
  // shared PersonAvatar.
  accountName?: string | null;
  tenantId?: string;
  // The club's branding initials. Accepted for the callers that already
  // pass them, but NOT drawn in an account control: the academy mark is
  // branding, and an account control is a person.
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
      data-owner-surface
      data-testid="owner-shell"
      // lg:items-start keeps the sticky sidebar at its own height
      // instead of stretching it to the full column, which is what
      // makes it stay put while the page scrolls.
      //
      // pb-[var(--owner-content-bottom)] is the phone clearance: the
      // bottom navigation's height and the safe area, grown to the
      // floating action's footprint on a page that carries one (see the
      // :has() rule in app/globals.css). A page WITHOUT a create action
      // keeps the plain navigation clearance.
      className="min-h-[calc(100dvh-var(--app-sticky-offset))] pb-[var(--owner-content-bottom)] lg:flex lg:items-start lg:pb-0"
    >
      <OwnerChromeOffset />
      <aside
        data-testid="owner-sidebar"
        // Owner OpenPen (29 October 2026): the reference workspace has a
        // 190px owner sidebar — deep plum in Lavender, pale green in
        // Mint. It is still viewport-bound and sticky; only the nav
        // region scrolls. The palette is owner-scoped (see globals.css),
        // so Ops and the auth panel keep their existing pastel surface.
        style={{
          top: "var(--app-sticky-offset)",
          height: "calc(100dvh - var(--app-sticky-offset))",
        }}
        className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[190px] lg:flex-none lg:flex-col lg:overflow-hidden lg:border-r lg:border-[var(--owner-nav-border)] lg:bg-[var(--owner-nav-surface)] lg:px-3.5 lg:pb-5 lg:pt-4 lg:text-[var(--owner-nav-ink)] [--focus-ring:var(--owner-nav-focus)] print:hidden"
      >
        {/* Brand, club and the account stay OUTSIDE the navigation
            scroller, so a short screen never hides them. The product mark
            is the reference's KhelSuite club workspace; login and Ops
            keep their existing brand. */}
        <div
          data-testid="owner-shell-brand"
          className="flex-none px-2.5"
        >
          <p className="font-display text-[25px] font-medium leading-none tracking-[-1px] text-[var(--owner-nav-ink)]">
            KhelSuite
          </p>
          <span className="mt-1 block text-[11px] font-normal uppercase leading-[2] tracking-[2px] text-[var(--owner-nav-muted)]">
            Club workspace
          </span>
          {clubName ? (
            <div className="mt-3 flex items-center gap-2 border-b border-[var(--owner-nav-border)] pb-3">
              {clubLogoUrl ? <ClubMark name={clubName} logoUrl={clubLogoUrl} size={32} /> : null}
              <div className="min-w-0 flex-1">
              <p
                className="truncate text-[14px] font-medium text-[var(--owner-nav-ink)]"
                title={clubName}
              >
                {clubName}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--owner-nav-muted)]">
                {accountLabel === "Manager" ? "Manager workspace" : "Owner workspace"}
              </p>
              </div>
            </div>
          ) : (
            <div className="mt-3 border-b border-[var(--owner-nav-border)] pb-4" />
          )}
        </div>

        {/* The only independent scroller in the shell: the navigation
            list. min-h-0 lets it shrink inside the flex column, so it
            scrolls instead of pushing the account off a short screen. */}
        <nav
          aria-label="Primary"
          data-testid="owner-side-nav-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1"
        >
          <OwnerSideNav groups={sidebarGroups} />
        </nav>

        <div
          data-testid="owner-shell-account"
          className="flex-none border-t border-[var(--owner-nav-border)] px-2.5 pt-3"
        >
          {/* The account row is a PERSON control: the mark is the signed-in
              person's own initials (the shared PersonAvatar — the name's
              graphemes on the theme tint), never the club's branding
              initials. A user with no name on file draws the primitive's
              honest unknown ("?"). */}
          {hasSettingsDestination ? (
            <Link
              href="/owner/settings"
              className="flex min-h-11 items-center gap-2.5 rounded-ctl px-1.5 py-1.5 motion-fast transition-colors hover:bg-[var(--owner-nav-hover)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-nav-focus)]"
            >
              <PersonAvatar name={accountName ?? ""} size={32} className="flex-none" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--owner-nav-ink)]">
                {accountLabel}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <PersonAvatar name={accountName ?? ""} size={32} className="flex-none" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--owner-nav-ink)]">
                {accountLabel}
              </span>
            </div>
          )}
          {!hasSettingsDestination ? (
            <TenantSignOut className="mt-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-nav-focus)]" />
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          data-testid="owner-top-bar"
          // Reference: a compact 62px sticky row with the breadcrumb, the
          // record search, the appearance control and the account avatar.
          //
          // On a phone the row is the approved COMPACT 52px one: the
          // club identity and the facility in scope sit in ONE row (the
          // mock's phone header), so the header does not grow to the
          // height of the two stacked.
          style={{ top: "var(--app-sticky-offset)" }}
          className="sticky top-0 z-30 flex min-h-[52px] items-center gap-2 border-b border-line bg-paper px-3 lg:min-h-[62px] lg:gap-3 lg:px-6"
        >
          <div className="hidden lg:block"><OwnerShellCrumb items={crumbItems} /></div>
          {/* The phone header carries the club identity, the facility in
              scope and the account — the mock's compact context row.
              The record search lives in the More panel, so the facility
              label keeps a readable width; the desktop search stays in
              the header and BOTH search instances stay mounted. */}
          <div role="group" aria-label="Club and facility" className="flex min-w-0 flex-1 items-center gap-2 lg:block lg:max-w-60 lg:flex-initial lg:shrink">
            {clubLogoUrl ? <span className="lg:hidden"><ClubMark name={clubName ?? "Club workspace"} logoUrl={clubLogoUrl} size={24} /></span> : null}
            <span title={clubName ?? "Club workspace"} className="min-w-0 flex-1 truncate text-sm font-medium lg:hidden">{clubName ?? "Club workspace"}</span>
            <div className="owner-facility min-w-0 max-w-[10.5rem] shrink-0 lg:mt-2 lg:w-full lg:max-w-none">
              {/* URL state can wait without replacing the workspace. */}
              <Suspense
                fallback={
                  <span role="status" className="text-xs text-ink-2">
                    Loading facilities…
                  </span>
                }
              >
                <FacilitySwitcher locations={locations} />
              </Suspense>
            </div>
          </div>
          <div className="hidden min-w-0 flex-1 lg:ml-auto lg:block lg:max-w-[300px]">
            <GlobalSearch icon={<OwnerIcon name="search" size={16} className="pointer-events-none absolute left-4 top-[26px] -translate-y-1/2 text-ink-3" />} />
          </div>
          <div className="hidden lg:block"><ThemeToggle compact /></div>
          <div data-testid="owner-header-account" className="flex-none">
            <OwnerAccountControl accountName={accountName} tenantId={tenantId} />
          </div>
        </header>

        {/* W1-6 — renders itself away for single-location tenants and
            keeps its existing `?facility=` behaviour; the desktop
            shell does not add a second switcher. */}

        <div data-testid="owner-content" className="min-w-0">
          {/* Owner OpenPen: the page owns its explicit 16/28px inset via
              OwnerPage. The shell adds no horizontal gutter, so the old
              32+20 double inset cannot return. */}
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </div>

        {!hasSettingsDestination ? (
          <div className="px-4 pb-4 lg:hidden">
            <TenantSignOut className="mt-4" />
          </div>
        ) : null}
      </div>

      <div data-testid="owner-mobile-nav" className="lg:hidden">
        <OwnerMobileNav
          navItems={navItems}
          sidebarGroups={sidebarGroups}
          search={<GlobalSearch icon={<OwnerIcon name="search" size={16} className="pointer-events-none absolute left-4 top-[26px] -translate-y-1/2 text-ink-3" />} />}
        />
      </div>
    </div>
  );
}
