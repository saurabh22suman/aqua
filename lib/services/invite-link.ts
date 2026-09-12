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
import {
  hasCredentialByPhone,
  pinSchema,
  setCredential,
} from "./credentials";
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
  | "tenant_suspended"
  // 2026-09-11 auth feature (set-PIN on redeem):
  // invalid_pin            — PIN shape failed before anything was consumed
  // credential_already_set — an invite/relogin link may not overwrite a PIN
  // not_owner              — only owner memberships may redeem reset links
  | "invalid_pin"
  | "credential_already_set"
  | "not_owner";

export type PreviewLoginLinkResult =
  | {
      kind: "ok";
      phone: string;
      roleKey: string;
      tenantName: string;
      purpose: InviteLinkPurpose;
      expiresAt: Date;
      // Whether the phone already has a PIN. The link page uses this
      // (plus purpose === "reset") to decide between the confirm
      // screen and the set-PIN screen.
      credentialSet: boolean;
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
  // The membership read is tenant-scoped; the credential check is a
  // platform read (ba_user/ba_account). Split into two steps so the
  // platform lookup runs after the tenant transaction closes.
  const tenantData = await withTenant(tenantId, async (tx) => {
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
    if (!m) return { kind: "error" as const, code: "membership_not_found" as const };
    if (m.status === "revoked") return { kind: "error" as const, code: "revoked" as const };
    if (m.tenantStatus !== "trial" && m.tenantStatus !== "active") {
      return { kind: "error" as const, code: "tenant_suspended" as const };
    }
    const used = await tx
      .select({ jti: inviteLinkUses.jti })
      .from(inviteLinkUses)
      .where(eq(inviteLinkUses.jti, claims.jti))
      .limit(1);
    if (used.length > 0) return { kind: "error" as const, code: "used" as const };
    return {
      kind: "ok" as const,
      phone: m.phone,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
      tenantStatus: m.tenantStatus,
    };
  });
  if (tenantData.kind === "error") return tenantData;

  const credentialSet = await hasCredentialByPhone(tenantData.phone);
  return {
    kind: "ok",
    phone: tenantData.phone,
    roleKey: tenantData.roleKey,
    tenantName: tenantData.tenantName,
    purpose: claims.purpose,
    expiresAt: new Date(claims.exp * 1000),
    credentialSet,
  };
}

export type RedeemLoginLinkResult =
  | {
      kind: "ok";
      sessionToken: string;
      homePath: string;
      // True when the membership still has no PIN and none was
      // supplied with this redeem. The route sends the browser to
      // /set-pin in that case; the session is still minted so the
      // gated page can act.
      needsCredential: boolean;
    }
  | { kind: "error"; code: RedeemLoginLinkError };

// Redeems a login link: consumes the jti (single-use), flips
// invited -> active, ensures the better-auth identity, optionally
// sets the PIN, and mints a real session. Everything membership-side
// happens in ONE tenant transaction (consume + status flip are
// atomic -- no window where the link is spent but the membership
// isn't active, or vice versa); identity + session happen after,
// under withPlatform, which nests freely and never touches tenant
// tables.
//
// Guard ordering (2026-09-11 auth feature):
//   1. PIN shape, before anything else — a malformed PIN must not
//      burn the single-use link.
//   2. Role/credential guards, before consuming — an invite/relogin
//      link can never overwrite an existing PIN, and only an owner
//      membership may redeem a reset link.
//   3. Consume + activate.
//   4. Set credential (reset: overwrite), revoke sessions on reset,
//      mint the session.
export async function redeemLoginLink(
  rawToken: string,
  opts?: { pin?: string },
): Promise<RedeemLoginLinkResult> {
  const claims = verifyInviteLinkToken(rawToken);
  if (!claims) return { kind: "error", code: "invalid" };

  const pin = opts?.pin;
  if (pin !== undefined && !pinSchema.safeParse(pin).success) {
    return { kind: "error", code: "invalid_pin" };
  }

  const tenantId = asTenantId(claims.tenantId);
  const consumed = await withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        userId: tenantMemberships.userId,
        phone: users.phone,
        roleKey: roles.key,
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
    // Defense in depth: issuance gates this, but a hand-signed token
    // must not let a non-owner redeem a reset.
    if (claims.purpose === "reset" && m.roleKey !== "owner") {
      return { kind: "error" as const, code: "not_owner" as const };
    }

    // Credential lookup is a platform read; it nests inside the
    // tenant scope without touching tenant tables.
    const hadCredential = await hasCredentialByPhone(m.phone);
    if (pin !== undefined && hadCredential && claims.purpose !== "reset") {
      return { kind: "error" as const, code: "credential_already_set" as const };
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
      hadCredential,
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

    if (pin !== undefined) {
      await setCredential(baUserId, pin);
    }
    // A successful reset revokes the owner's other sessions before
    // the fresh one is minted: the reset may be happening because a
    // device or session was compromised, and leaving those live
    // would defeat the point.
    if (claims.purpose === "reset" && pin !== undefined) {
      const baCtx = await auth.$context;
      await baCtx.internalAdapter.deleteUserSessions(baUserId);
    }
    const baCtx = await auth.$context;
    const session = await baCtx.internalAdapter.createSession(baUserId);
    return (session as { token: string }).token;
  });

  const needsCredential = pin === undefined && !consumed.hadCredential;
  return {
    kind: "ok",
    sessionToken,
    homePath: needsCredential ? "/set-pin" : (consumed.homePath ?? "/"),
    needsCredential,
  };
}
