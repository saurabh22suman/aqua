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
  return issueLoginLink(ctx.tenantId, parsed.data.membershipId);
}
