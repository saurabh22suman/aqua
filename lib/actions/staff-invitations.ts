"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  inviteStaff,
  listInvitations,
  revokeInvitation,
  resendInvitation,
  STAFF_INVITABLE_ROLES,
  type InviteStaffResult,
  type ListInvitationsRow,
  type RevokeStaffResult,
} from "@/lib/services/staff-invitations";

// Phase 3.6 — server actions for the staff invitations
// surface. parse-then-permission preamble (standing rule);
// management-only on writes, listInvitations is also
// management-only — viewing the staff roster's pending/active
// state is operational metadata, not something a coach needs.

const listInputSchema = z.object({}).optional();

export async function listInvitationsAction(): Promise<ListInvitationsRow[]> {
  // (1) parse — empty-args schema per the standing rule's
  // no-input branch.
  listInputSchema.parse({});
  // (2) permission
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return listInvitations({ tenantId: ctx.tenantId });
}

const inviteSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "Phone is required.")
    .max(40, "Phone is too long."),
  fullName: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(200, "Name is too long."),
  roleKey: z.enum(STAFF_INVITABLE_ROLES),
  locationIds: z.array(z.string().uuid()).max(50).default([]),
});

export type InviteStaffActionInput = z.input<typeof inviteSchema>;

export async function inviteStaffAction(
  input: unknown,
): Promise<InviteStaffResult> {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return inviteStaff({ tenantId: ctx.tenantId, userId: ctx.userId }, parsed.data);
}

const membershipIdSchema = z.string().uuid();

export async function revokeInvitationAction(
  membershipId: unknown,
): Promise<RevokeStaffResult> {
  const parsed = z.object({ membershipId: membershipIdSchema }).safeParse({ membershipId });
  if (!parsed.success) {
    return {
      kind: "error",
      code: "membership_not_found",
      message: "Invalid membership id.",
    };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return revokeInvitation(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}

export async function resendInvitationAction(
  membershipId: unknown,
): Promise<
  | { kind: "ok"; delivered: false }
  | { kind: "error"; code: "membership_not_found" | "not_invited" | "invalid"; message: string }
> {
  const parsed = z.object({ membershipId: membershipIdSchema }).safeParse({ membershipId });
  if (!parsed.success) {
    return { kind: "error", code: "invalid", message: "Invalid membership id." };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return resendInvitation(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
