// Sub-PR 2 of role gating — the four role-key guards
// (assertStaff, assertManagement, assertMembersWrite,
// assertEnquiriesAccess) and their `STAFF_ROLES` /
// `MANAGEMENT_ROLES` / `MEMBERS_WRITE_ROLES` / `ENQUIRIES_ROLES`
// constants are deleted. `requirePermission(ctx, "x.y")` in
// lib/auth/permission.ts is the single resolution; every action
// sweep now calls it.
//
// What stays here: the receptionist session TTL and its
// isSessionExpiredForRole check. That's not a permission check —
// it's a session-freshness check, called from
// lib/auth/context.ts:requireDefaultCtx and sessionExists. The
// 12-hour hard cap on a shared front-desk device is a separate
// concern from "what can this user do" and doesn't belong in the
// permission resolver.
//
// F-12 deletes all of these: role-key string comparisons are the F-04
// "Never" violation, tolerated only as an interim bridge to permission sets.
// Receptionist sessions are hard-capped from login (createdAt, NOT
// sliding): the front desk is a shared device, often a counter
// tablet, and a 30-day sliding session there means whoever walks up
// next inherits the last shift's identity. 12h covers a full working
// day plus handover; anything left logged in overnight is dead by
// morning. Owner/coach/admin stay on the 30-day sliding library
// session (personal phones). Pure function of (role, timestamps) so
// it is unit-testable without a session or a database.
export const RECEPTIONIST_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function isSessionExpiredForRole(
  roleKey: string,
  sessionCreatedAtMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (roleKey !== "receptionist") return false;
  return nowMs - sessionCreatedAtMs > RECEPTIONIST_SESSION_MAX_AGE_MS;
}
