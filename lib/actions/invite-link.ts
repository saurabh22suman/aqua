"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  issueLoginLink,
  type IssueLoginLinkResult,
} from "@/lib/services/invite-link";

// Tenant-side minting for staff magic-link login. Management-only:
// the owner mints links for their staff, and the link itself is the
// credential, so minting is the privileged step. Redeeming is a
// Route Handler (app/api/login-link/redeem), not an action here:
// the session cookie must be set explicitly on the response, and
// cookies().set() inside a Server Action does not emit Set-Cookie
// on the flight response in this Next version (verified: action
// ran, jar.set executed, no Set-Cookie header).
//
// The notification is queued INSIDE the issuance transaction (the
// service's `notify` option), so the link, its audit and its queued
// notification commit together. A second transaction here would let the
// issuance commit and then fail, which reported a committed credential
// as a failure and lost it.
//
// `notify: true` is all-or-nothing: a throw or a `false` from the helper
// rolls the issuance back and returns `notification_failed`. The service
// then records one fixed-code `staff.login_link_notification_failed` trace
// in its own transaction. If that trace write also fails, the action still
// returns `notification_failed`; the loss surfaces as one fixed safe alert
// (`notification_trace_write_failed`) with no ids, phone, token, error or
// stack.

const membershipIdSchema = z.string().uuid();

export async function issueLoginLinkAction(
  membershipId: unknown,
): Promise<IssueLoginLinkResult> {
  const parsed = z.object({ membershipId: membershipIdSchema }).safeParse({ membershipId });
  if (!parsed.success) {
    return { kind: "error", code: "membership_not_found", message: "Membership not found." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.invite");
  // A06 — pass the authenticated issuer so the service can deny
  // minting credentials for higher-trust targets before signing.
  return issueLoginLink(ctx.tenantId, parsed.data.membershipId, ctx, { notify: true });
}
