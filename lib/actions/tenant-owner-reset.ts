"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  issueTenantOwnerResetLink,
  type OwnerMembershipRow,
} from "@/lib/services/owner-reset";
import { listOwnerMemberships } from "@/lib/services/owner-reset";
import type { IssueLoginLinkResult } from "@/lib/services/invite-link-issue";

// PR2-C4 — tenant-side owner recovery actions. Standing preamble:
// (1) Zod parse, (2) permission check, (3) service. Reads ride
// settings.read (management surface); minting a reset link needs
// staff.invite (owner/admin) — the service still enforces that the
// TARGET is an active owner.

export async function listOwnerMembershipsAction(): Promise<
  OwnerMembershipRow[]
> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listOwnerMemberships(ctx.tenantId);
}

const resetInput = z.object({ membershipId: z.string().uuid() });

export async function issueTenantOwnerResetLinkAction(
  raw: unknown,
): Promise<IssueLoginLinkResult> {
  // (1) parse
  const parsed = resetInput.safeParse(raw);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "membership_not_found",
      message: "Pick an owner to reset.",
    };
  }
  // (2) permission: management only
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "staff.invite");
  // (3) service
  return issueTenantOwnerResetLink(ctx, parsed.data.membershipId);
}
