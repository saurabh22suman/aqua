import { Suspense, type ReactNode } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import type { NavItem } from "@/components/bottom-nav";
import { OwnerMobileNav, type OwnerMobileNavPreset } from "@/components/owner-ui/owner-mobile-nav";
import { OwnerNavigationScopeProvider } from "@/components/owner-ui/owner-navigation-scope";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerFacilityScopeProvider, OwnerHeaderFacilityScope } from "@/components/owner-home/owner-facility-scope";
import { FacilitySwitcher } from "@/components/facility-switcher";
import { GlobalSearch } from "@/components/global-search";
import { OwnerChromeOffset } from "@/components/owner-chrome-offset";
import { AccountAvatar, OwnerAccountControl } from "@/components/owner-home/owner-account-control";
import { OwnerShellCrumb } from "@/components/owner-shell-crumb";
import { OwnerSideNav } from "@/components/owner-side-nav";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { ClubMark } from "@/components/branding/club-mark";
import type { OwnerSidebarGroup } from "@/lib/nav";

// The document scrolls. The sidebar and tool row stay visible within it.
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
  scopeUserId,
  guideHomeHref,
  canChooseDefaultFacility = false,
  accountLabel = "Account",
  accountHref,
  mobileNavPreset = "legacy",
  brief = false,
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
  scopeUserId?: string;
  guideHomeHref?: string;
  canChooseDefaultFacility?: boolean;
  // The club's branding initials. Accepted for the callers that already
  // pass them, but NOT drawn in an account control: the academy mark is
  // branding, and an account control is a person.
  clubInitials?: string | null;
  // The signed-in role, as a label.
  accountLabel?: string;
  accountHref?: string;
  // The Owner-first phone preset. The layout derives it from the
  // authoritative server role key; it is presentation only.
  mobileNavPreset?: OwnerMobileNavPreset;
  // The approved 21 November brief shell/tokens are OWNER-only. The
  // owner layout derives this from the same server role key that gates
  // the Home composition; Admin and every other role keep the baseline
  // shell untouched.
  brief?: boolean;
  children: ReactNode;
}) {
  // R07 (2026-10-13 role-workflow audit) — the Settings destination is
  // gated on settings.manage, and it hosted the only sign-out. A role
  // without it (the Accountant) gets the shell-level sign-out instead,
  // so a session can always be ended.
  const hasSettingsDestination = navItems.some(
    (item) => item.href === "/owner/settings",
  );
  const personalSettingsHref = hasSettingsDestination ? "/owner/settings" : accountHref;
  const courtside = mobileNavPreset === "courtside";
  const groups = courtside && sidebarGroups ? courtsideSidebarGroups(sidebarGroups) : sidebarGroups;
  const crumbItems = groups ? groups.flatMap((group) => group.items) : navItems;

  return (
    <OwnerNavigationScopeProvider key={`${tenantId ?? ""}:${scopeUserId ?? ""}`}><OwnerFacilityScopeProvider control={<FacilitySwitcher locations={locations} facilityNoun={brief ? "Facility" : undefined} />}><div
      data-owner-surface
      data-owner-brief={brief ? "" : undefined}
      data-courtside={courtside ? "" : undefined}
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
          className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-[206px] lg:flex-none lg:flex-col lg:overflow-hidden lg:border-r lg:border-[var(--owner-nav-border)] lg:bg-[var(--owner-nav-surface)] lg:px-3.5 lg:pb-5 lg:pt-6 lg:text-[var(--owner-nav-ink)] courtside-rail [--focus-ring:var(--owner-nav-focus)] print:hidden"
      >
        {/* Brand, club and the account stay OUTSIDE the navigation
            scroller, so a short screen never hides them. The product mark
            is the reference's KhelSuite club workspace; login and Ops
            keep their existing brand. */}
        <div
          data-testid="owner-shell-brand"
          className="flex-none px-2.5"
        >
          {courtside ? (
            <Link href="/owner" className="courtside-brand" aria-label="KhelSuite Today">
              <span className="courtside-mark" aria-hidden="true" />
              <span>khelsuite<span className="courtside-brand-dot">.</span></span>
            </Link>
          ) : (
            <>
              <p className="font-display text-[25px] font-medium leading-none tracking-[-1px] text-[var(--owner-nav-ink)]">
                KhelSuite
              </p>
              <span className="mt-1 block text-[11px] font-normal uppercase leading-[2] tracking-[2px] text-[var(--owner-nav-muted)]">
                Business account
              </span>
            </>
          )}
          {clubName ? (
            <div className="courtside-club-card mt-3 flex items-center gap-2 border-b border-[var(--owner-nav-border)] pb-3">
              {clubLogoUrl ? <ClubMark name={clubName} logoUrl={clubLogoUrl} size={32} /> : courtside ? <span className="courtside-club-icon"><OwnerIcon name="pin" size={17} /></span> : null}
              <div className="min-w-0 flex-1">
              <p
                className="courtside-club-name truncate text-[14px] font-medium text-[var(--owner-nav-ink)]"
                title={clubName}
              >
                {clubName}
              </p>
              <p className="mt-0.5 text-[12px] text-[var(--owner-nav-muted)]">
                {accountLabel === "Club owner" ? "Owner" : accountLabel} workspace
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
          <Suspense fallback={null}><OwnerSideNav groups={groups} /></Suspense>
        </nav>

        <div
          data-testid="owner-shell-account"
          className="flex-none border-t border-[var(--owner-nav-border)] px-2.5 pt-3"
        >
          {/* The account row is a PERSON control: the mark is the signed-in
              person's own initials (the shared PersonAvatar — the name's
              graphemes on the theme tint), never the club's branding
              initials. A user with no name on file gets an account icon. */}
          {personalSettingsHref ? (
            <Link
              href={personalSettingsHref}
              aria-label={`Account — ${accountLabel}`}
              className="flex min-h-11 items-center gap-2.5 rounded-ctl px-1.5 py-1.5 motion-fast transition-colors hover:bg-[var(--owner-nav-hover)] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-nav-focus)]"
            >
              <AccountAvatar name={accountName} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--owner-nav-ink)]">
                {accountLabel}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <AccountAvatar name={accountName} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[var(--owner-nav-ink)]">
                {accountLabel}
              </span>
            </div>
          )}
          {!personalSettingsHref ? (
            <TenantSignOut className="mt-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--owner-nav-focus)]" />
          ) : null}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header
          data-testid="owner-top-bar"
          // The sticky reference header keeps identity, scope and account in
          // one row: 66px on mobile and 74px at the Owner desktop breakpoint.
          style={{ top: "var(--app-sticky-offset)" }}
          className="courtside-toolbar sticky top-0 z-30 flex min-h-[66px] items-center gap-2 border-b border-line bg-paper px-4 py-2.5 lg:min-h-[74px] lg:gap-3 lg:px-7 lg:py-3"
        >
          <div className="hidden lg:block"><OwnerShellCrumb items={crumbItems} workspaceLabel={courtside && clubName ? clubName : undefined} /></div>
          {/* The phone header carries the club identity, the facility in
              scope and the account — the mock's compact context row.
              The record search lives in the More panel, so the facility
              label keeps a readable width; the desktop search stays in
              the header and BOTH search instances stay mounted. */}
          <div role="group" aria-label="Business account and club" className="flex min-w-0 flex-1 items-center gap-2 lg:block lg:max-w-60 lg:flex-initial lg:shrink">
            {clubLogoUrl ? <span className="lg:hidden"><ClubMark name={clubName ?? "Club workspace"} logoUrl={clubLogoUrl} size={24} /></span> : courtside ? <span className="courtside-mark lg:hidden" aria-hidden="true" /> : null}
            <span className="min-w-0 flex-1 lg:hidden"><span title={clubName ?? "Club workspace"} className="brief-shell-club block truncate text-[13px] font-medium">{clubName ?? "Club workspace"}</span>{brief ? <span className="brief-shell-wordmark" aria-hidden="true">khelsuite.</span> : null}{courtside ? null : <span className="block truncate text-[11px] text-ink-2">{accountLabel}</span>}</span>
            <div className="owner-facility min-w-0 max-w-[10.5rem] shrink-0 lg:w-full lg:max-w-none">
              {/* URL state can wait without replacing the workspace. */}
              <Suspense
                fallback={
                  <span role="status" className="text-xs text-ink-2">
                    Loading clubs…
                  </span>
                }
              >
                <OwnerHeaderFacilityScope />
              </Suspense>
            </div>
          </div>
          {brief ? <div data-owner-brief-scope-slot="" className="brief-shell-scope-slot" /> : null}
          <div className="hidden min-w-0 flex-1 lg:ml-auto lg:block lg:max-w-[300px]">
            <GlobalSearch icon={<OwnerIcon name="search" size={16} className="pointer-events-none absolute left-4 top-[26px] -translate-y-1/2 text-ink-3" />} />
          </div>
          <div className={courtside ? "flex-none" : "hidden lg:block"}><ThemeToggle compact courtside={courtside} /></div>
          <div data-testid="owner-header-account" className="flex-none">
            <OwnerAccountControl accountName={accountName} tenantId={tenantId} guideHomeHref={guideHomeHref} canChooseDefaultFacility={canChooseDefaultFacility} accountHref={accountHref} />
          </div>
        </header>

        {/* W1-6 — renders itself away for single-location tenants and
            keeps its existing `?facility=` behaviour; the desktop
            shell does not add a second switcher. */}

        <div data-testid="owner-content" className="min-w-0">
          {/* Owner OpenPen: the page owns its explicit 16/28px inset via
              OwnerPage. The shell adds no horizontal gutter, so the old
              32+20 double inset cannot return. */}
          <div className="courtside-content mx-auto w-full max-w-[1180px]">{children}</div>
        </div>

        {!personalSettingsHref ? (
          <div className="px-4 pb-4 lg:hidden">
            <TenantSignOut className="mt-4" />
          </div>
        ) : null}
      </div>

      <div data-testid="owner-mobile-nav" className="lg:hidden">
        <Suspense fallback={null}><OwnerMobileNav
          navItems={navItems}
          sidebarGroups={sidebarGroups}
          preset={mobileNavPreset}
          search={<GlobalSearch icon={<OwnerIcon name="search" size={16} className="pointer-events-none absolute left-4 top-[26px] -translate-y-1/2 text-ink-3" />} />}
        /></Suspense>
      </div>
    </div></OwnerFacilityScopeProvider></OwnerNavigationScopeProvider>
  );
}

function courtsideSidebarGroups(groups: OwnerSidebarGroup[]): OwnerSidebarGroup[] {
  const primary: Record<string, string> = {
    "/owner": "Today",
    "/owner/enquiries": "Enquiries",
    "/owner/schedule": "Schedule",
    "/owner/members": "Members",
    "/owner/fees": "Fees",
    "/owner/announcements": "Updates",
    "/owner/inbox": "Updates inbox",
  };
  const available = groups.flatMap((group) => group.items);
  const workspace = Object.entries(primary).flatMap(([href, label]) => {
    const item = available.find((entry) => entry.href === href);
    return item ? [{ ...item, label }] : [];
  });
  const other = available.filter((item) => !Object.hasOwn(primary, item.href));
  return [
    { label: "Owner workspace", items: workspace },
    { label: "Club operations", items: other },
  ].filter((group) => group.items.length > 0);
}
