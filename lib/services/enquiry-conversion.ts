import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, type EnquirySource, type EnquiryStage } from "@/db/schema/enquiries";
import type { ActionCtx } from "@/lib/auth/context";
import { ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import { createMember, enrolMember, type GuardianInput } from "@/lib/services/register";
import { transitionMemberStatus } from "@/lib/services/member-status";
import { nextMemberCode } from "@/lib/services/people";
import {
  visibleBatch,
  visibleMember,
} from "@/lib/services/resource-access";
import type { ConsentGrantInput } from "@/lib/services/consent";
import type { MemberId } from "@/lib/ids";
import {
  enquiryConditions,
  enquiryScope,
  visibleEnquiry,
} from "@/lib/services/enquiry-scope";

// C-14/C-15 — turning an enquiry into a member: booking a trial,
// converting, and the conversion rate by source.

const MAX_CODE_ATTEMPTS = 5;
const DUPLICATE_CODE_MARKER = "members_tenant_member_code_key";

function duplicateCodeMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string } };
  return e.cause?.message ?? e.message ?? "";
}

export type NewMemberDetails = {
  dateOfBirth: string;
  gender?: string;
  locationId: string;
  medicalNotes?: string;
  guardian?: GuardianInput;
  consents: ConsentGrantInput[];
};

// C-14: books a trial against a real batch by creating a real member
// (status 'trial') and enrolling them -- not a separate booking
// record. This is NOT one atomic transaction: withTenant() cannot
// nest (db/scope.ts), so createMember, enrolMember and the enquiry
// update below are three sequential transactions, same shape as
// scripts/seed.ts's createMember-then-enrolMember and
// createMemberAction's own retry loop (lib/actions/people.ts). If
// enrolment or the enquiry update fails after the member was created,
// the member row still exists -- a receptionist retrying the booking
// sees "this enquiry already has a member linked" (below) rather than
// silently creating a second one.
export async function bookTrial(
  ctx: ActionCtx,
  input: { enquiryId: string; batchId: string; phone?: string; details: NewMemberDetails },
): Promise<{ ok: true; memberId: MemberId } | { ok: false; error: string }> {
  const enquiry = await withTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleEnquiry(tx, ctx, input.enquiryId);
    if (!visible) return null;
    // R04 — the trial batch must be visible to the caller (tenant,
    // live, location in scope; coach-assignment applies if ever
    // reachable from a coach role). A forged batch id is refused
    // before any member is created.
    if (!(await visibleBatch(tx, ctx, input.batchId))) return null;
    return visible;
  });
  if (!enquiry) return { ok: false, error: "Enquiry or batch not found." };
  if (enquiry.memberId) return { ok: false, error: "This enquiry already has a member linked." };

  const fromStage = enquiry.stage as EnquiryStage;
  if (!(ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? []).includes("trial_scheduled")) {
    return { ok: false, error: `Cannot book a trial from stage ${fromStage}.` };
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const memberCode = await nextMemberCode(ctx);
    let created;
    try {
      created = await createMember(ctx, {
        fullName: enquiry.fullName,
        phone: input.phone ?? enquiry.phone ?? undefined,
        dateOfBirth: input.details.dateOfBirth,
        gender: input.details.gender,
        locationId: input.details.locationId,
        memberCode,
        medicalNotes: input.details.medicalNotes,
        guardian: input.details.guardian,
        consents: input.details.consents,
        witnessedByUserId: ctx.userId,
        initialStatus: "trial",
      });
    } catch (err) {
      if (duplicateCodeMessage(err).includes(DUPLICATE_CODE_MARKER) && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
    if (!created.ok) return created;

    await enrolMember(ctx, { memberId: created.memberId, batchId: input.batchId });
    await withTenant(ctx.tenantId, (tx) =>
      tx
        .update(enquiries)
        .set({
          memberId: created.memberId,
          trialBatchId: input.batchId,
          stage: "trial_scheduled",
          // R04 — assigning the trial site also resolves a legacy
          // unassigned enquiry; an already-assigned row is untouched.
          ...(enquiry.locationId ? {} : { locationId: input.details.locationId as never }),
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(enquiries.id, input.enquiryId)),
    );
    return { ok: true, memberId: created.memberId };
  }
  return { ok: false, error: "Could not generate a unique member code. Try again." };
}

// C-15: converts an enquiry to a member, preserving source
// attribution (enquiries.source survives untouched; enquiries.member_id
// links to the resulting member either way). Two paths: the enquiry
// already has a member (a trial happened, C-14) -- just move that
// member trial -> active. Or it doesn't (converting directly, no
// trial) -- create the member fresh via createMember, same as C-06's
// registration flow, status active immediately.
export async function convertEnquiry(
  ctx: ActionCtx,
  input: { enquiryId: string; reason: string; newMember?: NewMemberDetails },
): Promise<{ ok: true; memberId: MemberId } | { ok: false; error: string }> {
  const enquiry = await withTenant(ctx.tenantId, async (tx) => {
    const visible = await visibleEnquiry(tx, ctx, input.enquiryId);
    if (!visible) return null;
    if (visible.memberId && !(await visibleMember(tx, ctx, visible.memberId))) return null;
    return visible;
  });
  if (!enquiry) return { ok: false, error: "Enquiry not found." };

  const fromStage = enquiry.stage as EnquiryStage;
  if (!(ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? []).includes("converted")) {
    return { ok: false, error: `Cannot convert an enquiry from stage ${fromStage}.` };
  }

  if (enquiry.memberId) {
    const result = await transitionMemberStatus(ctx, {
      memberId: enquiry.memberId,
      toStatus: "active",
      reason: input.reason,
    });
    if (!result.ok) return result;

    await withTenant(ctx.tenantId, (tx) =>
      tx
        .update(enquiries)
        .set({ stage: "converted", updatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(enquiries.id, input.enquiryId)),
    );
    return { ok: true, memberId: enquiry.memberId };
  }

  if (!input.newMember) {
    return { ok: false, error: "Member details are required to convert an enquiry that never had a trial." };
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const memberCode = await nextMemberCode(ctx);
    let created;
    try {
      created = await createMember(ctx, {
        fullName: enquiry.fullName,
        phone: enquiry.phone ?? undefined,
        dateOfBirth: input.newMember.dateOfBirth,
        gender: input.newMember.gender,
        locationId: input.newMember.locationId,
        memberCode,
        medicalNotes: input.newMember.medicalNotes,
        guardian: input.newMember.guardian,
        consents: input.newMember.consents,
        witnessedByUserId: ctx.userId,
      });
    } catch (err) {
      if (duplicateCodeMessage(err).includes(DUPLICATE_CODE_MARKER) && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
    if (!created.ok) return created;

    await withTenant(ctx.tenantId, (tx) =>
      tx
        .update(enquiries)
        .set({
          memberId: created.memberId,
          stage: "converted",
          // R04 — conversion resolves a legacy unassigned enquiry to
          // the site chosen for the new member.
          ...(enquiry.locationId ? {} : { locationId: input.newMember!.locationId as never }),
          updatedAt: new Date(),
          updatedBy: ctx.userId,
        })
        .where(eq(enquiries.id, input.enquiryId)),
    );
    return { ok: true, memberId: created.memberId };
  }
  return { ok: false, error: "Could not generate a unique member code. Try again." };
}

export type SourceConversion = { source: EnquirySource; total: number; converted: number; ratePct: number };

// C-15 done-when: "conversion rate by source is reportable."
export async function conversionRateBySource(ctx: ActionCtx): Promise<SourceConversion[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const { predicate } = await enquiryScope(tx, ctx);
    const rows = await tx
      .select({
        source: enquiries.source,
        total: sql<number>`count(*)::int`,
        converted: sql<number>`count(*) filter (where ${enquiries.stage} = 'converted')::int`,
      })
      .from(enquiries)
      .where(and(...enquiryConditions(ctx, predicate)))
      .groupBy(enquiries.source)
      .orderBy(enquiries.source);

    return rows.map((r) => ({
      source: r.source as EnquirySource,
      total: r.total,
      converted: r.converted,
      ratePct: r.total > 0 ? Math.round((r.converted / r.total) * 100) : 0,
    }));
  });
}
