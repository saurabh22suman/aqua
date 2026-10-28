import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { BottomNav, type NavItem } from "@/components/bottom-nav";
import { Button } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { OpsMobileMenu } from "@/components/ops/ops-mobile-menu";
import { OpsNavLinks } from "@/components/ops/ops-nav-links";

// The operator console is not an installable app.
//
// The tenant surface publishes a web app manifest, and the console's
// pages must not advertise one. The manifest DOCUMENT is never served
// on the platform host (it is not in OPS_ALLOWLIST, so the console is
// not installable either way), and the <link rel="manifest"> itself is
// rendered only on the tenant surface
// (components/pwa/manifest-link.tsx) — so the console's HTML carries no
// install metadata at all.
//
// This typed override is the framework-level guard for that rule: it
// withdraws a manifest declared anywhere up the tree (the root layout
// today declares none) from these pages, and nothing else about the
// console's metadata changes — title, description, theme colour and
// viewport are still inherited from the root layout.
//
// Why the link is not simply left to Next's app/manifest.ts file
// convention: that convention injects <link rel="manifest"> into every
// document that inherits the root layout and re-applies it after every
// metadata merge, so no layout — this one, or the root layout itself —
// can withdraw it. Verified on Next 15.5.24.
export const metadata: Metadata = {
  manifest: null,
};

// Ops redesign (28 October 2026) — the approved console shell.
//
// The approved 20-page concept gives Ops its own LIGHT rail, painted
// from the preset's sidebar token (Mint Garden pale mint, Lavender
// Club pale lilac). The console is NOT the tenant workspace: it keeps
// its own wordmark, its own navigation contract and its own density,
// and it does not import the owner's chrome.
//
// Scroll ownership — the house rule (components/owner-shell.tsx):
//
//   - ONE vertical scroll owner: the document. The content column is
//     not a second scroller, so route navigation, browser Back and
//     anchor links keep the browser's own scroll behaviour.
//   - The rail is viewport-bound and sticky: it stays visible while
//     the page scrolls and never grows past the viewport.
//   - ONLY the navigation region scrolls inside the rail, so an
//     overflowing menu stays usable on a short screen while the brand
//     and the exit control stay reachable without scrolling.
//
// The phone keeps the approved four-item bottom bar (Overview /
// Tenants / Feature catalogue / Presets). It cannot carry every
// destination, so the remaining ones live behind the compact Menu
// toggle in the phone bar (components/ops/ops-mobile-menu.tsx).
//
// The signed-in ROLE is read from the server session and never from a
// client field: a viewer gets a read-only console in the UI, and the
// server still refuses a forged write.

const PLATFORM_MOBILE_NAV: NavItem[] = [
  { href: "/ops", label: "Overview", iconName: "layout-dashboard", exact: true },
  { href: "/ops/tenants", label: "Tenants", iconName: "building-2" },
  { href: "/ops/features", label: "Catalogue", iconName: "list-checks" },
  { href: "/ops/presets", label: "Presets", iconName: "sliders-horizontal" },
];

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The login and verify pages render inside this layout too; gate
  // their content behind auth where required.
  const status = await platformAuthStatusAction();

  // Nobody is signed in (or a challenge is pending): the console shows
  // a focused authentication surface with NO navigation at all. An
  // empty navigation landmark on the sign-in screen is noise for a
  // screen reader and an invitation to guess at destinations that are
  // not there.
  if (status.kind !== "authenticated") {
    return (
      <div className="min-h-dvh bg-deck text-ink">
        <main className="mx-auto w-full max-w-5xl px-5 py-10 md:px-10 md:py-16">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div
      data-testid="ops-shell"
      // md:items-start keeps the sticky rail at its own height instead
      // of stretching it to the full column, which is what makes it
      // stay put while the page scrolls.
      className="min-h-[calc(100dvh-var(--app-sticky-offset))] pb-[calc(4rem+env(safe-area-inset-bottom))] md:flex md:items-start md:pb-0"
    >
      <aside
        data-testid="ops-sidebar"
        // The sticky offset and height follow the app chrome that sits
        // above the shell (the demo banner publishes its height as
        // --app-sticky-offset). Without it the rail slides under that
        // chrome and its brand is clipped.
        style={{
          top: "var(--app-sticky-offset)",
          height: "calc(100dvh - var(--app-sticky-offset))",
        }}
        className="hidden md:sticky md:top-0 md:flex md:h-dvh md:w-60 md:flex-none md:flex-col md:overflow-hidden md:border-r md:border-line md:bg-sidebar print:hidden"
      >
        {/* The brand, above the navigation and outside its scroller. */}
        <div
          data-testid="ops-shell-brand"
          className="flex-none border-b border-line px-5 pb-4 pt-6"
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-3">
            Aqua operator
          </p>
          <p className="mt-1 font-display text-[18px] font-semibold leading-tight text-ink">
            <Link href="/ops" className="hover:opacity-80">
              Aqua Control Plane
            </Link>
          </p>
        </div>

        {/* The only independent scroller inside the rail: the navigation
            list. It keeps the <nav> landmark (the landmark and the
            scroll owner are the same element) and min-h-0 lets it
            shrink inside the flex column, so it scrolls instead of
            pushing the exit control off a short screen. */}
        <nav
          aria-label="Platform"
          data-testid="ops-side-nav-scroll"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3"
        >
          <OpsNavLinks />
        </nav>

        {/* The account row and the exit control, below the navigation
            scroller, so they stay reachable on a short screen. */}
        <div
          data-testid="ops-shell-account"
          className="flex-none border-t border-line px-5 py-4 text-[12px] text-ink-3"
        >
          <p>
            Signed in as <span className="text-ink">{status.role}</span>
          </p>
          {/* R03 (2026-10-13 role-workflow audit) — a viewer gets a
              read-only platform; writes are refused server-side.
              Hiding the controls is supplementary, not the enforcement. */}
          {status.role === "viewer" ? (
            <p className="mt-1 leading-relaxed">
              Read-only: this account can browse, not change, platform data.
            </p>
          ) : null}
          {/* The appearance control (components/theme/theme-toggle.tsx)
              is the SHARED control, reused as it is: the provider, the
              component and the tokens are unchanged. It sits in the
              account area beside the role and the exit, because that is
              where a personal display preference belongs — it is not a
              preview toolbar, and it is not the tenant's branding. */}
          <ThemeToggle className="mt-2 w-full justify-center" />
          <form action={signOutFormAction} className="mt-2">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              className="w-full"
            >
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* The phone bar: brand, Menu toggle and the exit control. It
            is a sticky row so every destination stays reachable on a
            short phone screen. */}
        <header
          data-testid="platform-mobile-header"
          className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-paper px-4 py-2 md:hidden"
        >
          <Link
            href="/ops"
            className="order-1 font-display text-[15px] font-semibold text-ink"
          >
            Aqua Control Plane
          </Link>
          <OpsMobileMenu />
          <div className="order-2 ml-auto flex items-center gap-2">
            <ThemeToggle />
            <form action={signOutFormAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <main className="px-5 py-6 pb-10 md:px-10 md:py-10">{children}</main>

        {/* X-D1 (2026-09-13 audit §7.5): at md+ the desktop rail
            takes over; the bottom bar must not render alongside it.
            The wrapper, not the nav's own classes, carries the
            breakpoint because BottomNav is shared with mobile-first
            tenant surfaces. */}
        <div className="md:hidden">
          <BottomNav items={PLATFORM_MOBILE_NAV} />
        </div>
      </div>
    </div>
  );
}

async function signOutFormAction() {
  "use server";
  const { logoutPlatformAction } = await import("@/lib/actions/platform-auth");
  await logoutPlatformAction();
  redirect("/ops/login");
}
