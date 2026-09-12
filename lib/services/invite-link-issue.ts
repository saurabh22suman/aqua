import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { tenants } from "@/db/schema/tenants";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";
import {
  signInviteLinkToken,
  INVITE_LINK_TTL_SECONDS,
  RELOGIN_LINK_TTL_SECONDS,
  RESET_LINK_TTL_SECONDS,
} from "./invite-link-token";
import { normaliseToE164 } from "@/lib/phone";
import type { TenantId } from "@/lib/ids";

// Minting side of staff magic-link login (architecture §6.1).
// Redeeming lives in ./invite-link.ts; the token codec in
// ./invite-link-token.ts.

export type IssueLoginLinkError =
  | "membership_not_found"
  | "revoked"
  // Owner reset (2026-09-11 auth feature): reset is owner-only and
  // only meaningful for an active membership. An invited owner uses
  // the invite flow, whose set-PIN screen is the same UX.
  | "not_owner"
  | "not_active";

export type IssueLoginLinkResult =
  | {
      kind: "ok";
      token: string;
      urlPath: string;
      purpose: InviteLinkPurpose;
      expiresAt: Date;
      phone: string;
      roleKey: string;
      tenantName: string;
    }
  | { kind: "error"; code: IssueLoginLinkError; message: string };

// Mints a login link for a membership. Purpose (and TTL) derives
// from status: invited -> invite (72h), active -> relogin (24h).
// Revoked memberships are refused -- revocation therefore kills
// outstanding unspent links at redeem time too (redeem re-checks).
export async function issueLoginLink(
  tenantId: TenantId,
  membershipId: string,
): Promise<IssueLoginLinkResult> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        phone: users.phone,
        roleKey: roles.key,
        tenantName: tenants.name,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) {
      return { kind: "error", code: "membership_not_found", message: "Membership not found." };
    }
    if (m.status === "revoked") {
      return { kind: "error", code: "revoked", message: "This membership was revoked." };
    }
    if (m.status !== "invited" && m.status !== "active") {
      return { kind: "error", code: "membership_not_found", message: "Membership not found." };
    }
    const purpose: InviteLinkPurpose = m.status === "invited" ? "invite" : "relogin";
    const ttl = purpose === "invite" ? INVITE_LINK_TTL_SECONDS : RELOGIN_LINK_TTL_SECONDS;
    const { token, claims } = signInviteLinkToken({
      tenantId,
      membershipId,
      purpose,
      ttlSeconds: ttl,
    });
    return {
      kind: "ok",
      token,
      urlPath: `/login/link/${token}`,
      purpose,
      expiresAt: new Date(claims.exp * 1000),
      phone: m.phone,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
    };
  });
}

// Phone-keyed variant for the platform operator: the operator knows
// the owner's number, not their membership id. This is also the
// single-owner lockout escape -- a logged-out sole owner cannot
// mint their own link, so the operator mints it for them over
// whatever human channel they already share (call, email).
export async function issueLoginLinkForPhone(
  tenantId: TenantId,
  rawPhone: string,
): Promise<IssueLoginLinkResult> {
  const membershipId = await findMembershipIdByPhone(tenantId, rawPhone);
  if (!membershipId) {
    return { kind: "error", code: "membership_not_found", message: "No membership for that number on this tenant." };
  }
  return issueLoginLink(tenantId, membershipId);
}

async function findMembershipIdByPhone(
  tenantId: TenantId,
  rawPhone: string,
): Promise<string | null> {
  const phone = normaliseToE164(rawPhone);
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ membershipId: tenantMemberships.id })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(users.phone, phone),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.membershipId ?? null;
  });
}

// 2026-09-11 auth feature: ops-issued owner PIN reset.
//
// Why a dedicated path instead of a flag on issueLoginLink: the
// guards are different. A reset must be an ACTIVE owner (an invited
// owner uses the invite flow) and its purpose is special-cased at
// redeem (overwrite the credential, revoke other sessions). Keeping
// issuance here makes the role/status check provably run before any
// token exists, and the redeem path re-checks the role so a
// hand-signed token cannot bypass the guard.
export async function issueOwnerResetLink(
  tenantId: TenantId,
  membershipId: string,
): Promise<IssueLoginLinkResult> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        status: tenantMemberships.status,
        phone: users.phone,
        roleKey: roles.key,
        tenantName: tenants.name,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(roles, eq(roles.id, tenantMemberships.roleId))
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .where(
        and(
          eq(tenantMemberships.id, membershipId),
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .limit(1);
    const m = rows[0];
    if (!m) {
      return { kind: "error", code: "membership_not_found", message: "Membership not found." };
    }
    if (m.status === "revoked") {
      return { kind: "error", code: "revoked", message: "This membership was revoked." };
    }
    if (m.roleKey !== "owner") {
      return {
        kind: "error",
        code: "not_owner",
        message: "Reset links are issued to owners only.",
      };
    }
    if (m.status !== "active") {
      return {
        kind: "error",
        code: "not_active",
        message: "This owner has not activated yet — use an invite link.",
      };
    }
    const { token, claims } = signInviteLinkToken({
      tenantId,
      membershipId,
      purpose: "reset",
      ttlSeconds: RESET_LINK_TTL_SECONDS,
    });
    return {
      kind: "ok",
      token,
      urlPath: `/login/link/${token}`,
      purpose: "reset",
      expiresAt: new Date(claims.exp * 1000),
      phone: m.phone,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
    };
  });
}

export async function issueOwnerResetLinkForPhone(
  tenantId: TenantId,
  rawPhone: string,
): Promise<IssueLoginLinkResult> {
  const membershipId = await findMembershipIdByPhone(tenantId, rawPhone);
  if (!membershipId) {
    return { kind: "error", code: "membership_not_found", message: "No membership for that number on this tenant." };
  }
  return issueOwnerResetLink(tenantId, membershipId);
}
