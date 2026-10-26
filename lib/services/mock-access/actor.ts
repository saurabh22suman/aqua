// Mock-only gate access — the actor contract.
//
// The gate services depend on a narrow capability, not on the whole
// request context: who is acting, in which tenant, and what they are
// allowed to do. The permission set is the one the request layer
// already resolved (lib/auth/permission.ts), so a service here cannot
// accidentally widen it.
//
// The management permission is settings.manage, which the owner and
// administrator templates carry and the desk roles do not. Its module
// ("settings") is in lib/auth/permission.ts's ALWAYS_ON_MODULES, so the
// feature-entitlement half of requirePermission can never fail for it
// and the permission-set check below is the whole gate.

import type { TenantId, UserId } from "@/lib/ids";

export const GATE_MANAGEMENT_PERMISSION = "settings.manage";

export type GateActor = {
  tenantId: TenantId;
  userId: UserId;
  permissions: Set<string>;
  requestId?: string;
};

export function gateActorMayManage(actor: GateActor): boolean {
  return actor.permissions.has(GATE_MANAGEMENT_PERMISSION);
}

export const GATE_FORBIDDEN = "You are not allowed to manage gate access.";
