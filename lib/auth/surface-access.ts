// Tenant role gating — surface access lists.
//
// Each tenant route group has a layout that gates on membership +
// session existence today (`sessionExists()`); this module replaces
// the role-vs-surface policy with an explicit, audited list. The
// principle: an owner of a club should not see a coach's URL just
// because they have a session; a coach should not see an owner's URL
// just because they have a session; a parent has no UI today at all
// beyond the magic-link `/p/[token]` route.
//
// Why not "any role with permission X can see surface Y"? The audit
// found the layout-level check is the only thing standing between a
// coach and a child's DOB/phone/guardian. A surface isn't a
// permission — it's the frame a user is in, and a role that doesn't
// belong to that frame sees nothing at all (404, per §2 of the RED
// proposal in docs/red-proposals.md).
//
// The role-to-surface map is data, not branching logic. Each role
// lives in exactly one surface; cross-surface roles (an owner who
// also opens /coach to monitor their own coaching) intentionally
// don't exist — owners get full read access through the owner
// surface, and they have full administrative rights there. Adding a
// cross-surface relationship is a deliberate product decision and a
// separate change.

export const SURFACE_OWNER = "owner" as const;
export const SURFACE_COACH = "coach" as const;
export const SURFACE_RECEPTION = "reception" as const;
export const SURFACE_PARENT = "parent" as const;

export type TenantSurface =
  | typeof SURFACE_OWNER
  | typeof SURFACE_COACH
  | typeof SURFACE_RECEPTION
  | typeof SURFACE_PARENT;

// `roleKey` strings from `roles.key` (F-04's "Never": never branch on
// role NAME at runtime — but this IS the role name lookup, not a
// branch on behaviour. The map exists because layout gating
// genuinely is role-shaped, and the alternative is encoding the
// role-to-surface relationship in permissions and forcing every
// layout to enumerate permissions — strictly more work, strictly
// less clear, and easier to get wrong because a permission could
// leak across surfaces when the permission set changes).
//
// Today the seeded roles are: owner, admin, accountant, receptionist,
// coach, worker. Parent has no staff-side surface today (the
// `/parent` route is a stub for S5; the real parent surface is
// `/p/[token]` outside this gate).
const TENANT_ROLE_TO_SURFACE: Record<string, TenantSurface | null> = {
  owner: SURFACE_OWNER,
  admin: SURFACE_OWNER,
  // K3 follow-up: accountant routes through the owner surface because
  // their permission set (reports.financial, invoices.write,
  // payments.record) lives there. A dedicated accountant surface is
  // a separate, deliberate product decision.
  accountant: SURFACE_OWNER,
  receptionist: SURFACE_RECEPTION,
  coach: SURFACE_COACH,
  // Worker has no UI today (scope §195); their home path is /parent
  // as a placeholder so an authenticated worker doesn't land on a
  // dead-end mislabeled page. They are NOT a parent — but until the
  // worker surface exists, /parent is the closest landing.
  worker: SURFACE_PARENT,
};

export function surfaceForRole(roleKey: string): TenantSurface | null {
  return TENANT_ROLE_TO_SURFACE[roleKey] ?? null;
}

// Fails-closed: a role with no surface mapping is treated as
// "deny every tenant surface". This is the audit's "forget to
// update the role list" class closed at the source — adding a
// fifth role without extending TENANT_ROLE_TO_SURFACE means the
// role gets 404 on every layout, which a permission-matrix test
// (sub-PR 3) will catch.
export function canAccessSurface(roleKey: string, surface: TenantSurface): boolean {
  return TENANT_ROLE_TO_SURFACE[roleKey] === surface;
}
