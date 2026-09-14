import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_COACH } from "@/lib/auth/surface-access";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

// See app/(owner)/layout.tsx for the role-gating rationale. Coach
// surface today: owner, admin (no — they have /owner), coach only.
// `canAccessSurface` is the single role-to-surface resolver.
export default async function CoachLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_COACH)) {
    notFound();
  }
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav
        items={TENANT_SURFACE_NAV.coach}
      />
    </div>
  );
}
