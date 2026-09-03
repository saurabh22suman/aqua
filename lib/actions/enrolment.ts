"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff, assertMembersWrite } from "@/lib/auth/permissions";
import { enrolMember } from "@/lib/services/register";
import { listMemberEnrolments, type MemberEnrolment } from "@/lib/services/enrolment";

// B3 — backs the "Enrolment" section on the member detail page
// (owner and reception both reach it). assertStaff/assertMembersWrite
// both include the receptionist role: reception can view and enrol a
// member they just created without needing owner access.

const memberIdSchema = z.string().uuid();

export async function listMemberEnrolmentsAction(
  rawMemberId: string,
): Promise<MemberEnrolment[]> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listMemberEnrolments(ctx, memberId);
}

const enrolMemberInput = z.object({
  memberId: z.string().uuid(),
  batchId: z.string().uuid(),
});

export type EnrolMemberResult = { ok: true } | { ok: false; error: string };

export async function enrolMemberAction(raw: {
  memberId: string;
  batchId: string;
}): Promise<EnrolMemberResult> {
  const input = enrolMemberInput.parse(raw);
  const ctx = await requireDefaultCtx();
  assertMembersWrite(ctx);
  return enrolMember({ tenantId: ctx.tenantId }, input);
}
