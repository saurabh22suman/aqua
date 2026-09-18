import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { OwnerShell } from "@/components/owner-shell";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, SURFACE_OWNER } from "@/lib/auth/surface-access";
import { listLocations } from "@/lib/services/people";
import { TENANT_SURFACE_NAV } from "@/lib/nav";

// Owner layout — sub-PR 1 of the role-gating migration. The
// layout is the gate: `sessionExists()` admits any role with a
// session; the audit found that admits a coach, who can then type
// /owner/members and read every child's DOB, guardian phone and
// medical notes (DPDP exposure). canAccessSurface enforces the
// role-to-surface map. The audit's three layers are: (1) layout
// 404 on the wrong role, (2) action-level requirePermission for
// the right one, (3) the matrix test asserts both. Sub-PR 2 is
// the action sweep; sub-PR 3 is the matrix.
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
  // W1-6 — the switcher renders itself away for single-facility
  // tenants, so this query is the only cost a small academy pays.
  const locations = await listLocations(ctx);
  // U-10 — responsive shell: sidebar + top bar (with global search,
  // U-05) at lg, the existing four-item bottom nav below it. The
  // item list is unchanged: TENANT_SURFACE_NAV.owner.
  return (
    <OwnerShell navItems={TENANT_SURFACE_NAV.owner} locations={locations}>
      {children}
    </OwnerShell>
  );
}
