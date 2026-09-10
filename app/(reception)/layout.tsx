import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { BottomNav } from "@/components/bottom-nav";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_RECEPTION } from "@/lib/auth/surface-access";

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
    <div className="min-h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))]">
      {children}
      <BottomNav
        items={[
          { href: "/reception", label: "Today", iconName: "calendar-days" },
          { href: "/reception/members/new", label: "Add member", iconName: "user-plus" },
          { href: "/reception/enquiries", label: "Enquiries", iconName: "clipboard-list" },
          // K2 — fourth tab matches the design's 4-item bottom bar
          // (DESIGN.md §2). The sign-out form lives at /reception/me.
          { href: "/reception/me", label: "Me", iconName: "user-round" },
        ]}
      />
    </div>
  );
}