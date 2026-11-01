"use server";

import { z } from "zod";
import { requireOpsAdminAction } from "@/lib/actions/platform-auth";
import { recordOpsMutationTrace, recordOpsThrownFailure } from "@/lib/auth/ops-operation";
import {
  issueLoginLinkForPhone,
  issueOwnerResetLinkForPhone,
  type IssueLoginLinkResult,
} from "@/lib/services/invite-link";
import { asTenantId, asUserId } from "@/lib/ids";
import { opsAction } from "@/db/ops-action";

// Platform-side login-link minting for tenant owners. The operator
// is not tenant management, so this cannot reuse the tenant-side
// issueLoginLinkAction -- it gates on the platform session instead
// and takes the owner's phone (which the operator knows) rather
// than a membership id (which they don't). Covers both the fresh
// invite ("share this link with the new owner") and the
// single-owner lockout ("the sole owner is logged out and nobody
// on the tenant can mint them a link").
const ownerLinkInput = z.object({
  tenantId: z.string().uuid(),
  phone: z.string().trim().min(1).max(40),
});

export async function issueOwnerLoginLinkAction(
  input: unknown,
): Promise<IssueLoginLinkResult> {
  // (1) parse
  const parsed = ownerLinkInput.safeParse(input);
  if (!parsed.success) {
    await recordOpsMutationTrace("tenant.owner_login_link.issue", "invalid");
    return { kind: "error", code: "membership_not_found", message: "Pick a tenant and a phone number." };
  }
  // (2) platform-session permission check
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("tenant.owner_login_link.issue", "denied");
    return {
      kind: "error",
      code: "membership_not_found",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }
  // (3) service
  const result = await opsAction({
    scope: "tenant.owner_login_link.issue", actorId: asUserId(status.userId),
    tenantId: parsed.data.tenantId,
  }, () => issueLoginLinkForPhone(asTenantId(parsed.data.tenantId), parsed.data.phone)).catch(async (error: unknown) => {
    await recordOpsThrownFailure("tenant.owner_login_link.issue", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
  if (result.kind !== "ok") {
    await recordOpsMutationTrace("tenant.owner_login_link.issue", "error", { tenantId: parsed.data.tenantId });
  }
  return result;
}

// 2026-09-11 auth feature: owner PIN reset. Same guard shape as the
// login-link action above (parse -> platform session -> service).
// The service enforces owner-only + active-only; the action does not
// duplicate those checks, it just guarantees the caller is an
// authenticated operator.
const ownerResetInput = z.object({
  tenantId: z.string().uuid(),
  phone: z.string().trim().min(1).max(40),
});

export async function issueOwnerResetLinkAction(
  input: unknown,
): Promise<IssueLoginLinkResult> {
  // (1) parse
  const parsed = ownerResetInput.safeParse(input);
  if (!parsed.success) {
    await recordOpsMutationTrace("tenant.owner_reset_link.issue", "invalid");
    return { kind: "error", code: "membership_not_found", message: "Pick a tenant and a phone number." };
  }
  // (2) platform-session permission check
  const status = await requireOpsAdminAction();
  if (status.kind === "error") {
    await recordOpsMutationTrace("tenant.owner_reset_link.issue", "denied");
    return {
      kind: "error",
      code: "membership_not_found",
      message:
        status.reason === "forbidden"
          ? "Your platform account has read-only access."
          : "Your session has expired. Sign in again.",
    };
  }
  // (3) service
  const result = await opsAction({
    scope: "tenant.owner_reset_link.issue", actorId: asUserId(status.userId),
    tenantId: parsed.data.tenantId,
  }, () => issueOwnerResetLinkForPhone(asTenantId(parsed.data.tenantId), parsed.data.phone)).catch(async (error: unknown) => {
    await recordOpsThrownFailure("tenant.owner_reset_link.issue", error, { tenantId: parsed.data.tenantId });
    throw error;
  });
  if (result.kind !== "ok") {
    await recordOpsMutationTrace("tenant.owner_reset_link.issue", "error", { tenantId: parsed.data.tenantId });
  }
  return result;
}
