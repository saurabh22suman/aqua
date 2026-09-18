import { and, eq, isNull } from "drizzle-orm";
import { withTenant, withUser } from "./tenant";
import { tenantMemberships } from "./schema/memberships";
import { writeAudit } from "@/lib/audit/write";
import type { UserId } from "@/lib/ids";

// D1 — runs from lib/auth/server.ts's callbackOnVerification, the
// moment better-auth confirms OTP ownership of a phone. That's the
// only place "the invited user accepted" can be observed; there is
// no later "first authenticated request" step in this codebase, so
// this is where invited -> active happens, synchronously, once.
//
// userId is never client-supplied here — it's the users.id resolved
// from the phone number that was just OTP-verified (linkBetterAuthUser,
// db/platform.ts), so this can only ever touch the caller's own rows.
// withUser() additionally scopes the SELECT below by RLS's
// user_resolution policy (migration 0011, SELECT-only by design), and
// the UPDATE filters status = 'invited' — the only legal transition
// this function performs. An 'active' or 'revoked' row is left alone;
// revocation, once built, stays sticky against a later login.
//
// This used to write platform_audit_log (wrong actor space: that
// table's actorId FKs to platform_users.id, and the person accepting
// their own invite is a tenant member). E-02 closes the gap with the
// tenant-side audit_log instead: one membership.activate row per
// flipped membership, in the same withTenant() transaction as the
// status update. The actor is the invited user themselves —
// actor_type 'user', not 'staff': they are accepting their own
// invite (and an invited admin may have no staff row at all), so the
// action is a self-service identity transition rather than tenant
// staff acting on tenant data.
export async function activateInvitedMemberships(userId: UserId): Promise<void> {
  const invited = await withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        tenantId: tenantMemberships.tenantId,
      })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "invited"),
          isNull(tenantMemberships.deletedAt),
        ),
      );
    return rows;
  });

  for (const row of invited) {
    await withTenant(row.tenantId, async (tx) => {
      // `.returning` makes the audit conditional on the state change
      // actually landing: a concurrent activation that won the race
      // matches zero rows and must not leave a phantom audit row.
      const updated = await tx
        .update(tenantMemberships)
        .set({ status: "active", updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            eq(tenantMemberships.tenantId, row.tenantId),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, "invited"),
          ),
        )
        .returning({ id: tenantMemberships.id });
      if (updated.length === 0) return;

      await writeAudit(tx, {
        tenantId: row.tenantId,
        actorType: "user",
        actorId: userId,
        action: "membership.activate",
        entityType: "tenant_membership",
        entityId: row.membershipId,
        before: { status: "invited" },
        after: { status: "active" },
        changedFields: ["status"],
      });
    });
  }
}
