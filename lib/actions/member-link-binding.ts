"use server";

// POSTIMAGE — lib/actions/member-link-binding.ts  (candidate, NOT applied)
//
// THE STAFF ACTIONS FOR THE MEMBER/guardian PAIRING.
//
// Every action follows the repository's own order, and the order is the
// security boundary:
//
//   1. PARSE the input with Zod;
//   2. RESOLVE the caller's session (requireDefaultCtx);
//   3. CHECK the permission (requirePermission) — the ROLE GRANT, never
//      the layout;
//   4. CALL the service, which resolves the actor's REAL authority from
//      the actor's own membership rows.
//
// The service does the authority work again, from the database: a caller
// that claims a wider facility scope than it holds gets no wider
// authority. The action's check is the first line; the service's is the
// one that cannot be lied to.
//
// NO SMS AND NO OTP. Nothing here queues a message, and nothing here
// records that anybody owns a number.

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  confirmLinkBinding,
  issueMemberActivationToken,
  provisionMemberAccountLink,
  withdrawLinkBinding,
  type ActivationTokenResult,
  type BindingActionResult,
  type ProvisionResult,
} from "@/lib/services/member-link-binding";

const linkAudienceSchema = z.enum(["member", "guardian"]);

const linkActionSchema = z.object({
  audience: linkAudienceSchema,
  linkId: z.string().uuid(),
});

const provisionSchema = z.object({
  audience: linkAudienceSchema,
  accountUserId: z.string().uuid(),
  memberId: z.string().uuid().optional(),
  guardianshipId: z.string().uuid().optional(),
}).refine((input) => input.audience !== "guardian" ||
  (input.memberId !== undefined && input.guardianshipId !== undefined), {
  message: "A guardian link must name the guardianship and child membership.",
});

/**
 * CONFIRMS THE PAIRING.
 *
 * The mismatch is never a refusal condition: an OWNER, or a
 * FACILITY-LIMITED MANAGER, confirms that this account is this member's
 * account even when the two numbers differ.
 */
export async function confirmLinkBindingAction(raw: {
  audience: "member" | "guardian";
  linkId: string;
}): Promise<BindingActionResult> {
  const input = linkActionSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.link.confirm");
  return confirmLinkBinding(ctx, input);
}

/** TAKES THE STANDING CONFIRMATION BACK. */
export async function withdrawLinkBindingAction(raw: {
  audience: "member" | "guardian";
  linkId: string;
}): Promise<BindingActionResult> {
  const input = linkActionSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.link.confirm");
  return withdrawLinkBinding(ctx, input);
}

/**
 * ISSUES THE MEMBER'S ONE-TIME ACTIVATION LINK.
 *
 * The token is the credential for the activation. It is returned to the
 * caller — a staff member hands it to the member — and it is NEVER queued
 * to the outbox.
 */
export async function issueMemberActivationTokenAction(raw: {
  audience: "member" | "guardian";
  linkId: string;
}): Promise<ActivationTokenResult> {
  const input = linkActionSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.link.confirm");
  return issueMemberActivationToken(ctx, input);
}

/**
 * PROVISIONS THE LINK ROW THE ACTIVATION CONSUMES.
 *
 * The row is created 'invited'. The account is named EXPLICITLY: the
 * same account may be staff and member/guardian in the same club, and in
 * that case the account's own sign-in number is not the club's recorded
 * number, so the account cannot be derived from the member's record.
 */
export async function provisionMemberAccountLinkAction(raw: {
  audience: "member" | "guardian";
  accountUserId: string;
  memberId?: string;
  guardianshipId?: string;
}): Promise<ProvisionResult> {
  const input = provisionSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return provisionMemberAccountLink(ctx, input);
}
