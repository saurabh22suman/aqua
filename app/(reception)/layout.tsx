import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { StaffBottomNav } from "@/components/staff-ui/staff-bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_RECEPTION } from "@/lib/auth/surface-access";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

// See app/(owner)/layout.tsx. Reception surface: receptionist only
// (today). Owner/admin have the owner surface; coach has the coach
// surface; they don't need a back-door into /reception.
export default async function ReceptionLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch {
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_RECEPTION)) {
    notFound();
  }
  return (
    <div
      data-staff-surface
      className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]"
    >
      {children}
      <StaffBottomNav
        items={TENANT_SURFACE_NAV.reception}
      />
    </div>
  );
}