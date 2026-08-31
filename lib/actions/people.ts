"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff, assertMembersWrite } from "@/lib/auth/permissions";
import { z } from "zod";
import {
  createMemberSchema,
  listMembersFilterSchema,
  searchPersonsSchema,
  transitionMemberStatusSchema,
  updateMemberSchema,
} from "@/lib/schemas";

const memberIdSchema = z.string().uuid();
import { createMember } from "@/lib/services/register";
import {
  getMemberDetail,
  listLocations,
  listMembers,
  nextMemberCode,
  searchPersons,
  updateMember,
  type LocationOption,
  type MemberDetail,
  type MemberListRow,
  type PersonSearchRow,
} from "@/lib/services/people";
import { transitionMemberStatus } from "@/lib/services/member-status";
import type { CreateMemberInput } from "@/lib/schemas";

export async function listMembersAction(raw: {
  search?: string;
  status?: string;
  locationId?: string;
}): Promise<MemberListRow[]> {
  const input = listMembersFilterSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listMembers(ctx, input);
}

export async function getMemberDetailAction(rawMemberId: string): Promise<MemberDetail | null> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getMemberDetail(ctx, memberId);
}

export async function listLocationsAction(): Promise<LocationOption[]> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listLocations(ctx);
}

export async function searchPersonsAction(query: string): Promise<PersonSearchRow[]> {
  const parsed = searchPersonsSchema.safeParse(query);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return searchPersons(ctx, parsed.data);
}

const DUPLICATE_CODE_MARKER = "members_tenant_member_code_key";
const MAX_CODE_ATTEMPTS = 5;

function duplicateCodeMessage(err: unknown): string | undefined {
  const e = err as { message?: string; cause?: { message?: string } };
  return e.cause?.message ?? e.message;
}

// Creates the person, guardian (existing or new), consent grants and
// the member row in one transaction (createMember, lib/services/
// register.ts) -- exactly the "all one transaction, one receptionist
// sitting" this task asks for. The member code is generated here, not
// supplied by the caller: nextMemberCode reads outside createMember's
// transaction (see its own comment), so a concurrent registration can
// race to the same code -- caught by members_tenant_member_code_key
// and retried with a freshly generated one rather than surfacing a
// confusing constraint error to the receptionist.
export async function createMemberAction(
  raw: Omit<CreateMemberInput, "memberCode">,
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const input = createMemberSchema.omit({ memberCode: true }).parse(raw);
  const ctx = await requireDefaultCtx();
  assertMembersWrite(ctx);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const memberCode = await nextMemberCode(ctx);
    try {
      const result = await createMember(
        { tenantId: ctx.tenantId, userId: ctx.userId },
        { ...input, memberCode, witnessedByUserId: ctx.userId },
      );
      if (!result.ok) return result;
      return { ok: true, memberId: result.memberId };
    } catch (err) {
      const message = duplicateCodeMessage(err) ?? "";
      if (message.includes(DUPLICATE_CODE_MARKER) && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }
  return { ok: false, error: "Could not generate a unique member code. Try again." };
}

export async function updateMemberAction(raw: {
  memberId: string;
  fullName: string;
  phone?: string;
  dateOfBirth: string;
  gender?: string;
  locationId: string;
  medicalNotes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = updateMemberSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertMembersWrite(ctx);
  return updateMember(ctx, input.memberId, input);
}

export async function transitionMemberStatusAction(raw: {
  memberId: string;
  toStatus: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = transitionMemberStatusSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertMembersWrite(ctx);
  return transitionMemberStatus(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    input,
  );
}
