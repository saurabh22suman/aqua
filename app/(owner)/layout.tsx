import { ClubSelectionRequired } from "@/lib/auth/active-club";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { OwnerShell, ownerRoleLabel } from "@/components/owner-shell";
import { ownerSidebarGroupsWithBookings } from "@/components/owner-ui/owner-navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { withTenant } from "@/db/tenant";
import { callerIsLiveOwnerForSettingsOrDelegation } from "@/lib/services/owner-authority";
import { canAccessSurface, SURFACE_OWNER } from "@/lib/auth/surface-access";
import { listLocations } from "@/lib/services/people";
import { getBranding } from "@/lib/services/branding";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { getTerminology } from "@/lib/services/terminology";
import {
  ownerNavForPermissions,
  ownerSidebarGroupsForPermissions,
} from "@/lib/nav";

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
//
// Owner Lavender B (27 October 2026) — the shell now names the club
// it belongs to, so the owner always knows which academy the figures
// describe. The read is the same cheap single-row branding read the
// Home page already makes; it is taken here (rather than through the
// action) so the layout does not resolve the session a second time.
export default async function OwnerLayout({ children }: { children: ReactNode }) {
  let ctx;
  try {
    ctx = await requireDefaultCtx();
  } catch (error) {
    if (error instanceof ClubSelectionRequired) redirect("/clubs");
    redirect("/login");
  }
  if (!canAccessSurface(ctx.roleKey, SURFACE_OWNER)) {
    notFound();
  }
  // W1-6 — the switcher renders itself away for single-facility
  // tenants, so this query is the only cost a small academy pays.
  //
  // The reads are independent of each other, so they are batched.
  // The identity read is the EXISTING tenant-scoped one
  // (lib/services/staff.ts): it resolves the signed-in user's own full
  // name through withTenant, with the resolved ctx and no new grant, no
  // raw users query and no change to the auth or query scope. It runs
  // here — AFTER the context resolution and the surface gate above — so
  // a caller that never reached the owner surface reads no identity.
  //
  // The shell's account controls are PERSON controls: they draw the
  // owner's OWN initials, never the club's branding initials. A signed-in
  // owner who was never entered as a person has no name on file; the
  // shell then draws the shared primitive's honest unknown ("?").
  const [locations, branding, identity, liveOwner, terminology] = await Promise.all([
    listLocations(ctx),
    getBranding(ctx),
    getCurrentStaffIdentity(ctx),
    withTenant(ctx.tenantId, (tx) => callerIsLiveOwnerForSettingsOrDelegation(tx, ctx)),
    getTerminology(ctx),
  ]);
  // U-10 — responsive shell: sidebar + top bar (with global search,
  // U-05) at lg, the existing bottom nav below it. C01 — both lists
  // are permission-filtered: the Accountant gets Home (→ Fees),
  // Members, Fees & payments and Reports; Owner/Admin hold every gate
  // and see the full contract unchanged.
  //
  // Owner redesign (27 October 2026) — the booking desk joins the
  // desktop Scheduling group, but only for a caller who may read
  // bookings AND whose tenant is entitled to the booking feature. That
  // is the same pair of gates the BOOKINGS ROUTE enforces
  // (app/(owner)/owner/bookings/page.tsx), so the sidebar never offers
  // a destination that would answer 404. The mobile bottom nav keeps
  // its four items (DESIGN.md §2); the phone reaches the booking desk
  // through Settings, and the Operations lane owns those links.
  const sidebarGroups = ownerSidebarGroupsWithBookings(
    ownerSidebarGroupsForPermissions(ctx.permissions, terminology),
    ctx.permissions,
    ctx.features,
  ).map((group) => ({ ...group, items: group.items.filter((item) => liveOwner || item.href !== "/owner/settings") }))
    .filter((group) => group.items.length > 0);
  // Keep URL-dependent picker suspension local to the control.
  // Authorized navigation and content must not wait behind its fallback.
  return (
    <OwnerShell
      navItems={ownerNavForPermissions(ctx.permissions, terminology).filter((item) => liveOwner || item.href !== "/owner/settings")}
      sidebarGroups={sidebarGroups}
      locations={locations}
      clubName={branding.displayName ?? branding.fallbackDisplayName}
      clubLogoUrl={branding.logoUrl}
      tenantId={ctx.tenantId}
      accountName={identity?.fullName ?? null}
      accountLabel={ownerRoleLabel(ctx.roleKey)}
    >
      {children}
    </OwnerShell>
  );
}
