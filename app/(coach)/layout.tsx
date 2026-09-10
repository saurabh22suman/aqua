import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_COACH } from "@/lib/auth/surface-access";

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
        items={[
          { href: "/coach", label: "Today", iconName: "list-checks" },
          { href: "/coach/schedule", label: "Schedule", iconName: "calendar-days" },
          { href: "/coach/members", label: "Members", iconName: "users" },
          { href: "/coach/me", label: "Me", iconName: "user-round" },
        ]}
      />
    </div>
  );
}
