// The facility-scope registry.
//
// This module exists so the scope binding has ONE source of truth for
// the role keys whose reach is bounded by their own membership's
// facilities, and so that source is independent of every permission
// grant. It deliberately contains no permission keys and no grants:
// granting a capability is a separate, later decision and must never
// be a prerequisite for binding the scope.
//
// The registry is a predicate next to the role templates, in the same
// shape as isCoachLikeRoleKey in lib/services/resource-access.ts. It is
// not a call-site branch: the scope helper asks "is this role
// facility-scoped?" once, and every service continues to consult the
// helper rather than a role name.

import { MANAGER_ROLE_KEY } from "@/lib/services/manager-role-grants";

export const FACILITY_SCOPED_ROLE_KEYS = [MANAGER_ROLE_KEY] as const;

const FACILITY_SCOPED_ROLE_KEY_SET: ReadonlySet<string> = new Set(
  FACILITY_SCOPED_ROLE_KEYS,
);

export function isFacilityScopedRoleKey(
  roleKey: string | null | undefined,
): boolean {
  return (
    roleKey !== null &&
    roleKey !== undefined &&
    FACILITY_SCOPED_ROLE_KEY_SET.has(roleKey)
  );
}
