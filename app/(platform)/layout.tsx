import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { BottomNav, type NavItem } from "@/components/bottom-nav";

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

// Visually distinct from tenant surfaces so nobody confuses the two.
// Per Phase 1.2: own navigation. Tenant nav has a four-item bottom bar
// (DESIGN.md §2). The platform surface is desktop-first — sidebar and
// data tables stay the primary operator experience — but the Sep 2026
// mobile audit amendment makes it operable from a phone too: the same
// four-item bottom bar (Overview / Tenants / Feature catalogue /
// Presets), with sign-out in the mobile header so it never becomes a
// fifth item. Color: dark marine, the same hero-block token, with
// the accent reserved for the active nav item (DESIGN.md §1.2 — accent
// is reserved for primary action, not arbitrary UI tinting).

const PLATFORM_MOBILE_NAV: NavItem[] = [
  { href: "/ops", label: "Overview", iconName: "layout-dashboard", exact: true },
  { href: "/ops/tenants", label: "Tenants", iconName: "building-2" },
  { href: "/ops/features", label: "Feature catalogue", iconName: "list-checks" },
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
  return (
    <div className="min-h-screen flex bg-marine text-paper">
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-paper/10">
        <div className="px-5 py-6 border-b border-paper/10">
          <p className="text-[11px] uppercase tracking-[0.14em] text-paper/50">
            Aqua operator
          </p>
          <p className="mt-1 font-display text-[18px] font-semibold">
            <Link href="/ops" className="hover:opacity-80">
              Aqua Control Plane
            </Link>
          </p>
        </div>
        <nav aria-label="Platform" className="flex-1 px-2 py-3 text-[14px]">
          <PlatformNav status={status} />
        </nav>
        <SignedInBlock status={status} />
      </aside>
      <main className="flex-1 min-w-0 bg-deck text-ink">
        <MobilePlatformHeader status={status} />
        <div className="px-5 py-6 pb-24 md:px-10 md:py-10">{children}</div>
        {/* X-D1 (2026-09-13 audit §7.5): at md+ the desktop sidebar
            takes over; the bottom bar must not render alongside it.
            The wrapper, not the nav's own classes, carries the
            breakpoint because BottomNav is shared with mobile-first
            tenant surfaces. */}
        {status.kind === "authenticated" ? (
          <div className="md:hidden">
            <BottomNav items={PLATFORM_MOBILE_NAV} />
          </div>
        ) : null}
      </main>
    </div>
  );
}

function PlatformNav({
  status,
}: {
  status: Awaited<ReturnType<typeof platformAuthStatusAction>>;
}) {
  if (status.kind !== "authenticated") return null;
  return (
    <ul className="space-y-1">
      <PlatformNavItem href="/ops" label="Overview" />
      <PlatformNavItem href="/ops/tenants" label="Tenants" />
      <PlatformNavItem href="/ops/leads" label="Leads" />
      <PlatformNavItem href="/ops/features" label="Feature catalogue" />
      <PlatformNavItem href="/ops/presets" label="Presets" />
      <PlatformNavItem href="/ops/whatsapp" label="WhatsApp" />
      <PlatformNavItem href="/ops/activity" label="Activity log" />
    </ul>
  );
}

function PlatformNavItem({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-ctl px-3 py-2 text-paper/80 hover:bg-paper/5 hover:text-paper transition-colors duration-150"
      >
        {label}
      </Link>
    </li>
  );
}

function MobilePlatformHeader({
  status,
}: {
  status: Awaited<ReturnType<typeof platformAuthStatusAction>>;
}) {
  if (status.kind !== "authenticated") return null;
  return (
    <header
      data-testid="platform-mobile-header"
      className="md:hidden bg-marine text-paper px-5 py-3 flex items-center justify-between gap-3"
    >
      <p className="font-display text-[15px] font-semibold">Aqua operator</p>
      <form action={signOutFormAction}>
        <button
          type="submit"
          className="rounded-ctl border border-paper/20 px-3 py-1.5 text-[12px] text-paper hover:bg-paper/5 transition-colors duration-150"
        >
          Sign out
        </button>
      </form>
    </header>
  );
}

function SignedInBlock({
  status,
}: {
  status: Awaited<ReturnType<typeof platformAuthStatusAction>>;
}) {
  if (status.kind !== "authenticated") return null;
  return (
    <div className="px-5 py-4 border-t border-paper/10 text-[12px] text-paper/60">
      <p>
        Signed in as <span className="text-paper">{status.role}</span>
      </p>
      {/* R03 (2026-10-13 role-workflow audit) — a viewer gets a
          read-only platform; writes are refused server-side. Hiding
          the controls is supplementary, not the enforcement. */}
      {status.role === "viewer" ? (
        <p className="mt-1 text-paper/50">
          Read-only: this account can browse, not change, platform data.
        </p>
      ) : null}
      <form action={signOutFormAction}>
        <button
          type="submit"
          className="mt-2 rounded-ctl border border-paper/20 px-3 py-1.5 text-[12px] text-paper hover:bg-paper/5 transition-colors duration-150"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}

async function signOutFormAction() {
  "use server";
  const { logoutPlatformAction } = await import("@/lib/actions/platform-auth");
  await logoutPlatformAction();
  redirect("/ops/login");
}
