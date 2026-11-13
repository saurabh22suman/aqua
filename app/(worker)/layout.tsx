import { ClubSelectionRequired } from "@/lib/auth/active-club";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { getBranding } from "@/lib/services/branding";
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

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
  const brand = await getBranding(ctx);
  return <div data-staff-surface className="min-h-dvh"><StaffClubContext clubName={brand.displayName ?? brand.fallbackDisplayName} clubLogoUrl={brand.logoUrl} />{children}</div>;
}
