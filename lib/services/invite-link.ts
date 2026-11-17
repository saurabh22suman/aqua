import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
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
  CREDENTIAL_ISSUER,
  hasCredentialByPhone,
  hasCredentialByBaUserId,
  pinSchema,
} from "./credentials";
import { asTenantId } from "@/lib/ids";
import { redeemStaffLinkInTx } from "@/db/staff-link-redemption";
import { credentialHasher } from "@/lib/services/self-service-credential";
import { createAuth } from "@/lib/auth/server";

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
export {
  issueLoginLink,
  issueLoginLinkForPhone,
  issueOwnerResetLink,
  issueOwnerResetLinkForPhone,
} from "./invite-link-issue";

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
        linksValidFrom: tenantMemberships.linksValidFrom,
        phone: users.phone,
        betterAuthId: users.betterAuthId,
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
          isNull(users.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) return { kind: "error" as const, code: "membership_not_found" as const };
    if (m.status === "revoked") return { kind: "error" as const, code: "revoked" as const };
    if (m.tenantStatus !== "trial" && m.tenantStatus !== "active") {
      return { kind: "error" as const, code: "tenant_suspended" as const };
    }
    // R09 — a token minted before the membership's credential epoch
    // (set on reactivation) is dead even though the membership is live
    // again. Token iat is second-precision, so the rule is: reject
    // when the token's whole second precedes the epoch second; a link
    // issued in the same second as the epoch (the fresh reactivation
    // link) stays valid.
    if (
      m.linksValidFrom &&
      claims.iat * 1000 + 1000 <= m.linksValidFrom.getTime()
    ) {
      return { kind: "error" as const, code: "invalid" as const };
    }
    if (m.betterAuthId !== null) {
      if (m.betterAuthId.length === 0) return { kind: "error" as const, code: "invalid" as const };
      const [linked] = await tx.select({ id: baUser.id }).from(baUser)
        .where(eq(baUser.id, m.betterAuthId)).limit(1);
      if (!linked) return { kind: "error" as const, code: "invalid" as const };
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
      betterAuthId: m.betterAuthId,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
      tenantStatus: m.tenantStatus,
    };
  });
  if (tenantData.kind === "error") return tenantData;

  const credentialSet = tenantData.betterAuthId !== null
    ? await hasCredentialByBaUserId(tenantData.betterAuthId)
    : await hasCredentialByPhone(tenantData.phone);
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

// The verified link, identity, credential, activation, session and audits
// commit together. Session creation uses the same configured Better Auth
// factory bound to the transaction; its behavior is subject to the focused
// adapter compatibility and rollback tests recorded in this review packet.
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
  const pinHash = pin === undefined ? undefined : await (await credentialHasher()).hash(pin);
  return redeemStaffLinkInTx({
    claims,
    pinHash,
    issuer: CREDENTIAL_ISSUER,
    mintSession: async (tx, baUserId) => {
      const txAuth = createAuth(tx, { transactionalSession: true });
      const txCtx = await txAuth.$context;
      const session = await txCtx.internalAdapter.createSession(baUserId);
      if (!session) throw new Error("Better Auth session creation failed");
      return session.token;
    },
  });
}
