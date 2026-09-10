import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_OWNER } from "@/lib/auth/surface-access";

// Owner layout — sub-PR 1 of the role-gating migration. The
// layout is the gate: `sessionExists()` admits any role with a
// session; the audit found that admits a coach, who can then type
// /owner/members and read every child's DOB, guardian phone and
// medical notes (DPDP exposure). canAccessSurface enforces the
// role-to-surface map. The audit's three layers are: (1) layout
// 404 on the wrong role, (2) action-level requirePermission for
// the right one, (3) the matrix test asserts both.
//
// 404 (not 403) on the wrong role: same answer as a made-up
// path. A probing caller must not learn the surface exists, who
// it belongs to, or anything about the page around it.
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_OWNER)) {
    notFound();
  }
  return (
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav
        items={[
          { href: "/owner", label: "Home", iconName: "layout-dashboard" },
          { href: "/owner/members", label: "Members", iconName: "users" },
          { href: "/owner/reports", label: "Reports", iconName: "file-text" },
          { href: "/owner/settings", label: "Settings", iconName: "settings" },
        ]}
      />
    </div>
  );
}
