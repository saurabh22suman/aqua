import { ClubSelectionRequired } from "@/lib/auth/active-club";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { getBranding } from "@/lib/services/branding";
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";
import { StaffBottomNav } from "@/components/staff-ui/staff-bottom-nav";
import { staffSiteContext } from "@/lib/services/staff-scope";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

// A05 — the worker route group's frame. Like the other surfaces'
// layouts, this only steers the unauthenticated visitor to /login;
// the page authorizes itself (D2 page-guard principle).
export default async function WorkerLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch (error) {
    if (error instanceof ClubSelectionRequired) redirect("/clubs");
    redirect("/login");
  }
  if (ctx.roleKey !== "worker") notFound();

  const [brand, siteLabel] = await Promise.all([getBranding(ctx), staffSiteContext(ctx)]);
  return (
    <div data-staff-surface className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      <StaffClubContext clubName={brand.displayName ?? brand.fallbackDisplayName} clubLogoUrl={brand.logoUrl} roleLabel={ctx.roleKey} siteLabel={siteLabel} />
      {children}
      <StaffBottomNav items={TENANT_SURFACE_NAV.worker} />
    </div>
  );
}
