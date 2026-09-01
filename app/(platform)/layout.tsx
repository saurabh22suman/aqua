import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

// Visually distinct from tenant surfaces so nobody confuses the two.
// Per Phase 1.2: own navigation. Tenant nav has a four-item bottom bar
// (DESIGN.md §2). The platform surface is desktop-first — operators
// work from a laptop, not poolside — so the layout uses a vertical
// sidebar instead. Color: dark marine, the same hero-block token, with
// the accent reserved for the active nav item (DESIGN.md §1.2 — accent
// is reserved for primary action, not arbitrary UI tinting).
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
            <Link href="/platform" className="hover:opacity-80">
              Aqua Control Plane
            </Link>
          </p>
        </div>
        <nav className="flex-1 px-2 py-3 text-[14px]">
          <PlatformNav status={status} />
        </nav>
        <SignedInBlock status={status} />
      </aside>
      <main className="flex-1 min-w-0 bg-deck text-ink">
        <MobilePlatformHeader status={status} />
        <div className="px-5 py-6 md:px-10 md:py-10">{children}</div>
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
      <PlatformNavItem href="/platform" label="Overview" />
      <PlatformNavItem href="/platform/tenants" label="Tenants" />
      <PlatformNavItem href="/platform/features" label="Feature catalogue" />
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
    <header className="md:hidden bg-marine text-paper px-5 py-3">
      <p className="font-display text-[15px] font-semibold">Aqua operator</p>
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
  redirect("/platform/login");
}
