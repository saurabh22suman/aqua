import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { auth } from "@/lib/auth/server";
import { withTenant } from "@/db/tenant";
import { withPlatform } from "@/db/scope";
import { db } from "@/db/auth-db";
import { findOrCreateUserByPhone } from "@/db/user-account";
import { tenantMemberships } from "@/db/schema/memberships";
import { tenants } from "@/db/schema/tenants";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { baUser } from "@/db/schema/better-auth";
import { inviteLinkUses } from "@/db/schema/invite-link-uses";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";
import {
  verifyInviteLinkToken,
} from "./invite-link-token";
import { asTenantId, asUserId } from "@/lib/ids";

// Staff magic-link login: single-use, membership-bound invite and
// re-login links. The parallel door to phone OTP (architecture
// §6.1) — it exists because OTP has no delivery channel until
// WhatsApp lands, and every login, first and fiftieth, must work
// with zero vendors. OTP code is untouched; when a channel exists
// it lights up against the same users, phones and memberships.
//
// Single-use is enforced by the invite_link_uses table (see the
// migration header for why membership status alone is not enough):
// consume = insert the jti, unique PK makes double-redeem
// race-safe with no check-then-insert window.

export type { IssueLoginLinkResult } from "./invite-link-issue";
export { issueLoginLink, issueLoginLinkForPhone } from "./invite-link-issue";

export type RedeemLoginLinkError =
  | "invalid"
  | "used"
  | "revoked"
  | "membership_not_found"
  | "tenant_suspended";

export type PreviewLoginLinkResult =
  | {
      kind: "ok";
      phone: string;
      roleKey: string;
      tenantName: string;
      purpose: InviteLinkPurpose;
      expiresAt: Date;
    }
  | { kind: "error"; code: RedeemLoginLinkError };

// Reads everything the confirm screen needs WITHOUT consuming the
// link: the jti is inserted only by redeemLoginLink. All error
// kinds render the same generic page -- preview must not become
// an oracle for which links are live.
export async function previewLoginLink(rawToken: string): Promise<PreviewLoginLinkResult> {
  const claims = verifyInviteLinkToken(rawToken);
  if (!claims) return { kind: "error", code: "invalid" };

  const tenantId = asTenantId(claims.tenantId);
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        status: tenantMemberships.status,
        phone: users.phone,
        roleKey: roles.key,
        tenantName: tenants.name,
        tenantStatus: tenants.status,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.id, claims.membershipId),
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) return { kind: "error", code: "membership_not_found" };
    if (m.status === "revoked") return { kind: "error", code: "revoked" };
    if (m.tenantStatus !== "trial" && m.tenantStatus !== "active") {
      return { kind: "error", code: "tenant_suspended" };
    }
    const used = await tx
      .select({ jti: inviteLinkUses.jti })
      .from(inviteLinkUses)
      .where(eq(inviteLinkUses.jti, claims.jti))
      .limit(1);
    if (used.length > 0) return { kind: "error", code: "used" };
    return {
      kind: "ok",
      phone: m.phone,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
      purpose: claims.purpose,
      expiresAt: new Date(claims.exp * 1000),
    };
  });
}

export type RedeemLoginLinkResult =
  | { kind: "ok"; sessionToken: string; homePath: string }
  | { kind: "error"; code: RedeemLoginLinkError };

// Redeems a login link: consumes the jti (single-use), flips
// invited -> active, ensures the better-auth identity, and mints a
// real session. Everything membership-side happens in ONE tenant
// transaction (consume + status flip are atomic -- no window where
// the link is spent but the membership isn't active, or vice
// versa); identity + session happen after, under withPlatform,
// which nests freely and never touches tenant tables.
export async function redeemLoginLink(rawToken: string): Promise<RedeemLoginLinkResult> {
  const claims = verifyInviteLinkToken(rawToken);
  if (!claims) return { kind: "error", code: "invalid" };

  const tenantId = asTenantId(claims.tenantId);
  const consumed = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        userId: tenantMemberships.userId,
        phone: users.phone,
        homePath: roles.homePath,
        tenantStatus: tenants.status,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.id, claims.membershipId),
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) return { kind: "error" as const, code: "membership_not_found" as const };
    if (m.status === "revoked") return { kind: "error" as const, code: "revoked" as const };
    if (m.tenantStatus !== "trial" && m.tenantStatus !== "active") {
      return { kind: "error" as const, code: "tenant_suspended" as const };
    }

    // Consume first: on conflict the PK reports the double-redeem
    // and nothing else in this transaction is reachable.
    const used = await tx
      .insert(inviteLinkUses)
      .values({
        jti: claims.jti,
        tenantId,
        membershipId: m.membershipId,
        purpose: claims.purpose,
      })
      .onConflictDoNothing({ target: inviteLinkUses.jti })
      .returning({ jti: inviteLinkUses.jti });
    if (used.length === 0) return { kind: "error" as const, code: "used" as const };

    if (m.status === "invited") {
      await tx
        .update(tenantMemberships)
        .set({ status: "active", updatedAt: new Date(), updatedBy: m.userId })
        .where(
          and(
            eq(tenantMemberships.id, m.membershipId),
            eq(tenantMemberships.status, "invited"),
          ),
        );
    }
    return {
      kind: "ok" as const,
      userId: m.userId,
      phone: m.phone,
      homePath: m.homePath,
    };
  });
  if (consumed.kind === "error") return consumed;

  // Identity: the platform users row exists from the invite
  // (defensive find-or-create); the better-auth row may not --
  // nobody has OTP'd yet -- so create it with the same temp-email
  // shape phone signup uses, and link the two ids.
  const sessionToken = await withPlatform(async () => {
    const user = await findOrCreateUserByPhone(consumed.phone);
    const userId = asUserId(user.id);
    const tempEmail = `${consumed.phone}@phone.aqua.local`;
    const existing = await db
      .select({ id: baUser.id })
      .from(baUser)
      .where(eq(baUser.phoneNumber, consumed.phone))
      .limit(1);
    let baUserId: string;
    if (existing[0]) {
      baUserId = existing[0].id;
    } else {
      const inserted = await db
        .insert(baUser)
        .values({
          id: uuidv7(),
          name: consumed.phone,
          email: tempEmail,
          phoneNumber: consumed.phone,
          phoneNumberVerified: true,
        })
        .onConflictDoNothing({ target: baUser.email })
        .returning({ id: baUser.id });
      if (inserted[0]) {
        baUserId = inserted[0].id;
      } else {
        const retry = await db
          .select({ id: baUser.id })
          .from(baUser)
          .where(eq(baUser.email, tempEmail))
          .limit(1);
        baUserId = retry[0]!.id;
      }
    }
    await db
      .update(users)
      .set({ betterAuthId: baUserId, updatedAt: new Date() })
      .where(eq(users.id, userId));
    const baCtx = await auth.$context;
    const session = await baCtx.internalAdapter.createSession(baUserId);
    return (session as { token: string }).token;
  });

  return {
    kind: "ok",
    sessionToken,
    homePath: consumed.homePath ?? "/",
  };
}
