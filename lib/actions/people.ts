"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/permission";
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
  getMemberPayerView,
  listLocations,
  listMembers,
  nextMemberCode,
  searchPersons,
  updateMember,
  type LocationOption,
  type MemberDetail,
  type MemberListRow,
  type MemberPayerView,
  type PersonSearchRow,
} from "@/lib/services/people";
import { transitionMemberStatus } from "@/lib/services/member-status";
import { getMemberIdCardContext, type MemberIdCardContext } from "@/lib/services/member-id-card";
import type { CreateMemberInput } from "@/lib/schemas";

export async function listMembersAction(raw: {
  search?: string;
  status?: string;
  locationId?: string;
}): Promise<MemberListRow[]> {
  const input = listMembersFilterSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listMembers(ctx, input);
}

export async function getMemberDetailAction(rawMemberId: string): Promise<MemberDetail | null> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  // R02 direct-action gap: members.read alone is the roster read, not
  // the full 360. The Accountant holds members.read for the payer-only
  // surface but has neither attendance.read (teaching loop) nor
  // members.write (record editing), so the full projection — DOB,
  // medical notes, guardians, consent evidence — must not cross the
  // RSC boundary for that caller. Coach/Owner/Reception/Admin keep the
  // full detail; everyone else falls back to the payer projection.
  if (
    !hasPermission(ctx, "attendance.read") &&
    !hasPermission(ctx, "members.write")
  ) {
    return null;
  }
  return getMemberDetail(ctx, memberId);
}

// R02 — the payer-only read for the Accountant's member finance page.
// Gated by invoices.read (the reconcile grant), NOT members.read, and it
// returns the narrow getMemberPayerView projection: no DOB, medical
// notes, guardians or consent rows ever cross the RSC boundary here.
export async function getMemberPayerAction(
  rawMemberId: string,
): Promise<MemberPayerView | null> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "invoices.read");
  return getMemberPayerView(ctx, memberId);
}

export async function listLocationsAction(): Promise<LocationOption[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return listLocations(ctx);
}

export async function searchPersonsAction(query: string): Promise<PersonSearchRow[]> {
  const parsed = searchPersonsSchema.safeParse(query);
  if (!parsed.success) return [];
  const ctx = await requireDefaultCtx();
  // R07 (2026-10-13 role-workflow audit) — guardian lookup is a
  // member-editing flow (create/edit member). Riding members.write
  // keeps the Accountant's finance-only access from enumerating
  // person records through the search box.
  requirePermission(ctx, "members.write");
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
  requirePermission(ctx, "members.write");

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

export type UpdateMemberPatch = {
  fullName?: string;
  phone?: string | null;
  dateOfBirth?: string;
  gender?: "male" | "female" | "other" | null;
  locationId?: string;
  medicalNotes?: string | null;
  joinedOn?: string;
};

export async function updateMemberAction(
  raw: { memberId: string } & UpdateMemberPatch,
): Promise<
  | { ok: true; value: UpdateMemberPatch }
  | { ok: false; error: string }
> {
  // safeParse, not parse: an invalid edit (empty name, bad number)
  // is a user-facing refusal the inline editor renders, not a
  // thrown server error.
  const parsed = updateMemberSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That change is not valid.",
    };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  const { memberId, ...patch } = parsed.data;
  return updateMember(ctx, memberId, patch);
}

export async function transitionMemberStatusAction(raw: {
  memberId: string;
  toStatus: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = transitionMemberStatusSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.write");
  return transitionMemberStatus(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    input,
  );
}

// §5.2 — context for the member identity card. Owner and reception
// surfaces both read this on the member detail page. Returns null
// when the tenant is missing (e.g. deleted) — the page treats that
// as "skip the card" rather than crashing the surrounding detail.
//
// R07 (2026-10-13 role-workflow audit) — the action contract map
// already documented members.read; the implementation now enforces
// it like every other tenant read. The payload is tenant branding
// only (no member data), but an unpermissioned exported action is
// still an unpermissioned boundary.
export async function getMemberIdCardContextAction(): Promise<MemberIdCardContext | null> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  return getMemberIdCardContext({ tenantId: ctx.tenantId });
}
