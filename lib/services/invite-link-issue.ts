import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { tenants } from "@/db/schema/tenants";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import type { InviteLinkPurpose } from "@/db/schema/invite-link-uses";
import { writeAudit } from "@/lib/audit/write";
import { trustGateDenies } from "./credential-issuer-trust";
import { auditOpsCredential } from "@/db/ops-credential-audit";
import { enqueueInvitationNotification } from "@/lib/messaging/invitation-notification";
import {
  signInviteLinkToken,
  INVITE_LINK_TTL_SECONDS,
  RELOGIN_LINK_TTL_SECONDS,
  RESET_LINK_TTL_SECONDS,
} from "./invite-link-token";
import { normaliseToE164 } from "@/lib/phone";
import type { ActionCtx } from "@/lib/auth/context";
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
  | "not_active"
  // A06 — the issuer's trust rank is below the target's (e.g. an
  // Administrator minting an Owner credential). No token is signed.
  | "forbidden_target"
  // The notification could not be queued, so the issuance was rolled
  // back with it. Nothing was created and no credential was returned.
  | "notification_failed";

// The generated-login-link path queues the notification in the issuance's
// own transaction (docs/whatsapp-demo-flows.md: "Events enqueue durable
// outbox rows and audits in the originating transaction"). This sentinel
// carries that failure out of the transaction so it is rolled back, and
// lets the caller turn it into a bounded result instead of an unhandled
// error. It is deliberately module-private: callers never see it.
class InviteLinkNotificationError extends Error {
  constructor() {
    super("the invitation notification could not be queued");
    this.name = "InviteLinkNotificationError";
  }
}

export type IssueLoginLinkOptions = {
  // Queue the WhatsApp notification for the issued link. The enqueue
  // runs in the issuance transaction, so the credential and its
  // notification commit together or not at all.
  //
  // The contract at this boundary: `notify: true` requires the helper to
  // report a real queued row (`true`). A throw OR a `false` rolls the
  // issuance back and returns the bounded `notification_failed` result.
  // After that rollback the service writes exactly one
  // `staff.login_link_notification_failed` audit trace (fixed code
  // `notification_not_queued`, `rolledBack: true`). If even that trace
  // cannot be written, it emits exactly one fixed safe alert
  // (`notification_trace_write_failed`) with no cause, id, phone, token,
  // message or stack — the caller still receives `notification_failed`.
  notify?: boolean;
};

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

function forbiddenTarget(): IssueLoginLinkResult {
  return {
    kind: "error",
    code: "forbidden_target",
    message: "You cannot issue a credential for a higher-trust role.",
  };
}

// Mints a login link for a membership. Purpose (and TTL) derives
// from status: invited -> invite (72h), active -> relogin (24h).
// Revoked memberships are refused -- revocation therefore kills
// outstanding unspent links at redeem time too (redeem re-checks).
//
// A06 — when the authenticated issuer is supplied, the target's
// actual role rank must be at or below the issuer's rank, and a
// non-token issuance audit is written in the same transaction before
// the token is returned. System callers (platform operator phone
// flow) pass no issuer and keep their existing authority.
//
// opts.notify — queue the notification for the issued link in THIS
// transaction. The rule is documented (docs/whatsapp-demo-flows.md,
// "Connected event paths": "Events enqueue durable outbox rows and
// audits in the originating transaction", and a generated login link
// is one of those events), and the two sibling paths already obey it
// (lib/services/staff-invitations.ts: inviteStaff and resendInvitation
// both call enqueueInvitationNotification inside their withTenant
// transaction). A failed enqueue therefore aborts the transaction: the
// credential is never issued, never audited and never returned. Without
// this the issuance and its audit committed first and the notification
// was enqueued in a second transaction, so a failed enqueue left an
// issued credential that nobody received behind a reported failure.
export async function issueLoginLink(
  tenantId: TenantId,
  membershipId: string,
  issuer?: ActionCtx | null,
  opts?: IssueLoginLinkOptions,
): Promise<IssueLoginLinkResult> {
  return withTenant(tenantId, async (tx): Promise<IssueLoginLinkResult> => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        status: tenantMemberships.status,
        phone: users.phone,
        roleKey: roles.key,
        homeOrdinal: roles.homeOrdinal,
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
    if (await trustGateDenies(tx, tenantId, issuer, m.homeOrdinal)) {
      return forbiddenTarget();
    }
    const purpose: InviteLinkPurpose = m.status === "invited" ? "invite" : "relogin";
    const ttl = purpose === "invite" ? INVITE_LINK_TTL_SECONDS : RELOGIN_LINK_TTL_SECONDS;
    const { token, claims } = signInviteLinkToken({
      tenantId,
      membershipId,
      purpose,
      ttlSeconds: ttl,
    });
    const expiresAt = new Date(claims.exp * 1000);
    await auditOpsCredential(tx, tenantId, membershipId, purpose, expiresAt);
    if (issuer) {
      // Same transaction as the checks, before the token leaves this
      // function. Never token-bearing.
      await writeAudit(tx, {
        tenantId,
        actorId: issuer.userId ?? null,
        requestId: issuer.requestId ?? null,
        action: "staff.login_link_issued",
        entityType: "tenant_membership",
        entityId: membershipId,
        after: { purpose, phone: m.phone, expiresAt: expiresAt.toISOString() },
      });
    }
    if (opts?.notify) {
      // The notification is part of the issuance (see the note above), so
      // it is queued in this transaction. The reviewed helper REPORTS
      // whether it really queued: `false` means the membership was missing
      // or ineligible at its own read, or its outbox insert produced no
      // row. The issuance REQUIRES `true` — a false is the same failure as
      // a throw, because an issued credential nobody was notified about is
      // the state this contract exists to prevent. Either way the sentinel
      // aborts the transaction, so the credential, its audit and the token
      // are rolled back together.
      let queued = false;
      try {
        queued = await enqueueInvitationNotification(tx, tenantId, membershipId);
      } catch {
        queued = false;
      }
      if (!queued) throw new InviteLinkNotificationError();
    }
    return {
      kind: "ok",
      token,
      urlPath: `/login/link/${token}`,
      purpose,
      expiresAt,
      phone: m.phone,
      roleKey: m.roleKey,
      tenantName: m.tenantName,
    };
  }).catch(async (err: unknown): Promise<IssueLoginLinkResult> => {
    // The notification could not be queued, so the transaction was rolled
    // back: nothing was created, no audit row survived and no credential
    // was returned. Report it as a bounded result instead of letting an
    // operational failure escape as an unhandled error.
    if (err instanceof InviteLinkNotificationError) {
      // The rollback took every row this attempt wrote, so the trail would
      // show NOTHING — a silent failure. ONE bounded failure trace, written
      // in its OWN transaction after the rollback, records that an attempt
      // happened and was rolled back. It never claims an issuance, and it
      // carries a FIXED code: no cause, no message, no phone and no token.
      await recordFailedNotificationTrace(tenantId, membershipId, issuer);
      return {
        kind: "error",
        code: "notification_failed",
        message:
          "The sign-in link was not created because its notification could not be queued. Nothing was changed — please try again.",
      };
    }
    throw err;
  });
}

/**
 * The failure trace for an issuance whose notification could not be queued.
 *
 * It is written AFTER the rollback, in its own transaction, so it survives
 * the rollback that removed the issuance rows. It carries a fixed code and
 * nothing else: the cause is never copied, and neither is the recipient's
 * phone, the message body or the credential.
 *
 * The action name follows the documented rule (docs/whatsapp-demo-flows.md,
 * "Connected event paths": the credential and its notification commit
 * together or not at all) and is listed for Ops review in
 * docs/pilot-operations-runbook.md §1.
 *
 * The trace is best effort. If the audit store is down too, EXACTLY ONE fixed
 * alert is emitted (`notification_trace_write_failed`) and this function
 * still resolves: the caller's bounded `notification_failed` result is never
 * replaced by a diagnostic failure. The alert carries no cause, id, phone,
 * token, message or stack.
 */
async function recordFailedNotificationTrace(
  tenantId: TenantId,
  membershipId: string,
  issuer?: ActionCtx | null,
): Promise<void> {
  try {
    await withTenant(tenantId, async (tx) => {
      await writeAudit(tx, {
        tenantId,
        actorId: issuer?.userId ?? null,
        requestId: issuer?.requestId ?? null,
        action: "staff.login_link_notification_failed",
        entityType: "tenant_membership",
        entityId: membershipId,
        // A FIXED code and two booleans. Nothing from the exception.
        after: { code: "notification_not_queued", rolledBack: true },
      });
    });
  } catch {
    // The trace is best effort: if the audit store is unavailable too, the
    // caller's bounded result must still stand, and that result already tells
    // the operator the link was not created. A second write would only risk a
    // duplicate trace. ONE fixed alert is the only diagnostic that survives a
    // store outage: fixed text and fixed values, never the cause, an id, the
    // recipient's phone, the credential or a stack.
    console.error("[invite-link] notification failure trace could not be written", {
      code: "notification_trace_write_failed",
      rolledBack: true,
    });
  }
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
  issuer?: ActionCtx | null,
): Promise<IssueLoginLinkResult> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        status: tenantMemberships.status,
        phone: users.phone,
        roleKey: roles.key,
        homeOrdinal: roles.homeOrdinal,
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
    // A06 — only an issuer at or above the target owner's rank (i.e.
    // another active owner) may mint this reset. Platform-Ops callers
    // pass no issuer and keep their separate recovery authority.
    if (await trustGateDenies(tx, tenantId, issuer, m.homeOrdinal)) {
      return forbiddenTarget();
    }
    const { token, claims } = signInviteLinkToken({
      tenantId,
      membershipId,
      purpose: "reset",
      ttlSeconds: RESET_LINK_TTL_SECONDS,
    });
    await auditOpsCredential(tx, tenantId, membershipId, "reset", new Date(claims.exp * 1000));
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
