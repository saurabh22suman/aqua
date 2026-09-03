import { and, eq, isNull } from "drizzle-orm";
import { withTenant, withUser } from "./tenant";
import { tenantMemberships } from "./schema/memberships";
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
// No platform_audit_log write here on purpose: that table's actorId is
// a FK to platform_users.id (platform operators), and the person
// accepting their own invite is a tenant member, not a platform user
// — writing their id there would violate the FK. There's also no
// tenant-side audit_log yet (CLAUDE.md, architecture §8.10). Recording
// that gap rather than papering over it with a wrong write.
//
// TODO(F-14): invited -> active is a security-relevant transition
// (it's what grants tenant access) and today it is completely
// unaudited — no row anywhere records who/when/from-what-invite. Once
// F-14's tenant-side audit_log lands (docs/implementation-plan.md),
// write one here in the same withTenant() transaction as the status
// update. Do not build a one-off table for this before then.
export async function activateInvitedMemberships(userId: UserId): Promise<void> {
  const invitedTenantIds = await withUser(userId, async (tx) => {
    const rows = await tx
      .select({ tenantId: tenantMemberships.tenantId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "invited"),
          isNull(tenantMemberships.deletedAt),
        ),
      );
    return rows.map((r) => r.tenantId);
  });

  for (const tenantId of invitedTenantIds) {
    await withTenant(tenantId, (tx) =>
      tx
        .update(tenantMemberships)
        .set({ status: "active", updatedAt: new Date(), updatedBy: userId })
        .where(
          and(
            eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.status, "invited"),
          ),
        ),
    );
  }
}
