import { ClubSelectionRequired } from "@/lib/auth/active-club";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { StaffBottomNav } from "@/components/staff-ui/staff-bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_COACH } from "@/lib/auth/surface-access";
import { TENANT_SURFACE_NAV } from "@/lib/nav";
import { getBranding } from "@/lib/services/branding";
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";
import { staffSiteContext } from "@/lib/services/staff-scope";

// See app/(owner)/layout.tsx for the role-gating rationale. Coach
// surface today: owner, admin (no — they have /owner), coach only.
// `canAccessSurface` is the single role-to-surface resolver.
export default async function CoachLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch (error) {
    if (error instanceof ClubSelectionRequired) redirect("/clubs");
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_COACH)) {
    notFound();
  }
  const [brand, siteLabel] = await Promise.all([getBranding(ctx), staffSiteContext(ctx)]);
  return (
    <div
      data-staff-surface
      className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]"
    >
      <StaffClubContext clubName={brand.displayName ?? brand.fallbackDisplayName} clubLogoUrl={brand.logoUrl} roleLabel={ctx.roleKey} siteLabel={siteLabel} />
      {children}
      <StaffBottomNav
        items={TENANT_SURFACE_NAV.coach}
      />
    </div>
  );
}
