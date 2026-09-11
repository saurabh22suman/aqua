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
// the right one, (3) the matrix test asserts both. Sub-PR 2 is
// the action sweep; sub-PR 3 is the matrix.
//
// 404 (not 403) on the wrong role: same answer as a made-up
// path. A probing caller must not learn the surface exists, who
// it belongs to, or anything about the page around it.
//
// Feature gating: a nav item's featureKey makes BottomNav hide the
// tile when ctx.features does NOT contain that key. The set of
// feature keys that can gate a nav item is closed (see
// NAV_GATED_FEATURES below); adding a new gated feature means
// adding a nav item with that featureKey AND opening the
// corresponding page with a notFound() guard (architecture §7.3
// says both layers — the action gate is requirePermission, the
// page gate is this check, and the nav gate is the layout-level
// featureKey on the item).
const NAV_GATED_FEATURES = ["reports"] as const;

function hiddenFeaturesFor(ctxFeatures: ReadonlySet<string>): string[] {
  // BottomNav's filter: a nav item with featureKey=X is hidden iff
  // X is in the hiddenFeatures array. We pass the keys the tenant
  // does NOT have — that way an item whose featureKey matches an
  // off feature falls out, and an item whose featureKey matches an
  // on feature stays. The closed list above is the universe; an
  // item outside that list has no featureKey and is always shown.
  const out: string[] = [];
  for (const k of NAV_GATED_FEATURES) {
    if (!ctxFeatures.has(k)) out.push(k);
  }
  return out;
}

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
          // featureKey="reports" — the Reports tile hides when the
          // operator turns the reports feature off (architecture
          // §7.3, F-08 audit). The page itself also calls notFound()
          // for the same case so a typed-in URL doesn't reach the
          // action layer and trigger a ForbiddenError.
          { href: "/owner/reports", label: "Reports", iconName: "file-text", featureKey: "reports" },
          { href: "/owner/settings", label: "Settings", iconName: "settings" },
        ]}
        hiddenFeatures={hiddenFeaturesFor(ctx.features)}
      />
    </div>
  );
}
