import { and, eq, sql } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { enquiries, type EnquirySource, type EnquiryStage } from "@/db/schema/enquiries";
import type { ActionCtx, MutationActor } from "@/lib/auth/context";
import { ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import { createMemberInTx, enrolMemberInTx, type GuardianInput } from "@/lib/services/register";
import { transitionMemberStatusInTx } from "@/lib/services/member-status";
import { nextMemberCode, nextMemberCodeInTx } from "@/lib/services/people";
import {
  visibleBatch,
  visibleMember,
} from "@/lib/services/resource-access";
import type { ConsentGrantInput } from "@/lib/services/consent";
import type { MemberId } from "@/lib/ids";
import {
  enquiryConditions,
  enquiryScope,
  lockVisibleEnquiry,
  type VisibleEnquiry,
} from "@/lib/services/enquiry-scope";
import { auditEnquiryStateChanged, enquiryAuditState } from "@/lib/services/enquiry-audit";

// C-14/C-15 — turning an enquiry into a member: booking a trial,
// converting, and the conversion rate by source.

const MAX_CODE_ATTEMPTS = 5;
// PostgreSQL assigns this name to the inline constraint in migration 0006.
const MEMBER_CODE_CONSTRAINT = "members_tenant_id_member_code_key";

function isMemberCodeCollision(err: unknown): boolean {
  let cursor = err;
  for (let depth = 0; depth < 5 && cursor && typeof cursor === "object"; depth += 1) {
    const { code, constraint, cause } = cursor as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (code === "23505") return constraint === MEMBER_CODE_CONSTRAINT;
    cursor = cause;
  }
  return false;
}

export type NewMemberDetails = {
  dateOfBirth: string;
  gender?: string;
  locationId: string;
  medicalNotes?: string;
  guardian?: GuardianInput;
  consents: ConsentGrantInput[];
};

// A trial commits its member, enrolment and enquiry under the same lock.
class BookingRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "BookingRefused";
  }
}

export async function bookTrial(
  ctx: MutationActor,
  input: { enquiryId: string; batchId: string; phone?: string; details: NewMemberDetails },
): Promise<{ ok: true; memberId: MemberId } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const memberCode = await nextMemberCode(ctx);
    try {
      return await bookTrialInTx(ctx, input, memberCode);
    } catch (err) {
      if (err instanceof BookingRefused) {
        return { ok: false, error: err.reason };
      }
      if (isMemberCodeCollision(err) && attempt < MAX_CODE_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }
  return { ok: false, error: "Could not generate a unique member code. Try again." };
}

async function bookTrialInTx(
  ctx: MutationActor,
  input: { enquiryId: string; batchId: string; phone?: string; details: NewMemberDetails },
  memberCode: string,
): Promise<{ ok: true; memberId: MemberId } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const enquiry = await lockVisibleEnquiry(tx, ctx, input.enquiryId);
    // R04 — the trial batch must be visible to the caller (tenant,
    // live, location in scope; coach-assignment applies if ever
    // reachable from a coach role). A forged batch id is refused
    // before any member is created.
    if (!enquiry || !(await visibleBatch(tx, ctx, input.batchId))) {
      throw new BookingRefused("Enquiry or batch not found.");
    }
    if (enquiry.memberId) {
      throw new BookingRefused("This enquiry already has a member linked.");
    }

    const fromStage = enquiry.stage as EnquiryStage;
    if (!(ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? []).includes("trial_scheduled")) {
      throw new BookingRefused(`Cannot book a trial from stage ${fromStage}.`);
    }

    const created = await createMemberInTx(tx, ctx, {
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
    if (!created.ok) throw new BookingRefused(created.error);

    const enrolled = await enrolMemberInTx(tx, ctx, {
      memberId: created.memberId,
      batchId: input.batchId,
    });
    if (!enrolled.ok) throw new BookingRefused(enrolled.error);

    await tx
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
      .where(eq(enquiries.id, input.enquiryId));
    await auditEnquiryStateChanged(tx, ctx, {
      action: "enquiry.trial_book",
      id: input.enquiryId,
      before: enquiryAuditState(enquiry),
      after: {
        ...enquiryAuditState(enquiry),
        stage: "trial_scheduled",
        memberId: created.memberId,
        trialBatchId: input.batchId,
        locationId: enquiry.locationId ?? input.details.locationId,
      },
    });
    return { ok: true, memberId: created.memberId };
  });
}

type ConversionInput = {
  enquiryId: string;
  reason: string;
  newMember?: NewMemberDetails;
};

type ConversionResult = { ok: true; memberId: MemberId } | { ok: false; error: string };

// Success is identified by the enquiry's linked member. Serialize retries
// and stage changes on the enquiry row, and commit all writes together.
export async function convertEnquiry(
  ctx: MutationActor,
  input: ConversionInput,
): Promise<ConversionResult> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    try {
      return await convertEnquiryInTx(ctx, input);
    } catch (err) {
      if (!isMemberCodeCollision(err)) throw err;
    }
  }
  return { ok: false, error: "Could not generate a unique member code. Try again." };
}

async function convertEnquiryInTx(
  ctx: MutationActor,
  input: ConversionInput,
): Promise<ConversionResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const enquiry = await lockVisibleEnquiry(tx, ctx, input.enquiryId);
    if (!enquiry) return { ok: false, error: "Enquiry not found." };
    const fromStage = enquiry.stage as EnquiryStage;

    if (enquiry.memberId && !(await visibleMember(tx, ctx, enquiry.memberId))) {
      return { ok: false, error: "Enquiry not found." };
    }

    if (fromStage === "converted" && enquiry.memberId) {
      return { ok: true, memberId: enquiry.memberId };
    }

    if (!(ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? []).includes("converted")) {
      return { ok: false, error: `Cannot convert an enquiry from stage ${fromStage}.` };
    }

    if (enquiry.memberId) {
      // A completed trial may already be active after an older partial save.
      const acceptActive = fromStage === "trial_completed" && enquiry.trialBatchId !== null;
      const result = await transitionMemberStatusInTx(
        tx,
        ctx,
        { memberId: enquiry.memberId, toStatus: "active", reason: input.reason },
        acceptActive,
      );
      if (!result.ok) return result;
      await finishConversion(tx, ctx, enquiry, enquiry.memberId);
      return { ok: true, memberId: enquiry.memberId };
    }

    if (!input.newMember) {
      return { ok: false, error: "Member details are required to convert an enquiry that never had a trial." };
    }

    const newMember = input.newMember;
    const memberCode = await nextMemberCodeInTx(tx, ctx.tenantId);
    const created = await createMemberInTx(tx, ctx, {
      fullName: enquiry.fullName,
      phone: enquiry.phone ?? undefined,
      dateOfBirth: newMember.dateOfBirth,
      gender: newMember.gender,
      locationId: newMember.locationId,
      memberCode,
      medicalNotes: newMember.medicalNotes,
      guardian: newMember.guardian,
      consents: newMember.consents,
      witnessedByUserId: ctx.userId,
    });
    if (!created.ok) return created;

    await finishConversion(tx, ctx, enquiry, created.memberId, newMember.locationId);
    return { ok: true, memberId: created.memberId };
  });
}

async function finishConversion(
  tx: TenantTx,
  ctx: MutationActor,
  enquiry: VisibleEnquiry,
  memberId: MemberId,
  newMemberLocationId?: string,
): Promise<void> {
  await tx
    .update(enquiries)
    .set({
      memberId,
      stage: "converted",
      // R04 — conversion resolves a legacy unassigned enquiry to the
      // site chosen for the new member. A trial-linked conversion never
      // rewrites the location it already has.
      ...(enquiry.locationId || !newMemberLocationId
        ? {}
        : { locationId: newMemberLocationId }),
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    })
    .where(eq(enquiries.id, enquiry.id));
  await auditEnquiryStateChanged(tx, ctx, {
    action: "enquiry.convert",
    id: enquiry.id,
    before: enquiryAuditState(enquiry),
    after: {
      ...enquiryAuditState(enquiry),
      stage: "converted",
      memberId,
      locationId: enquiry.locationId ?? newMemberLocationId ?? null,
    },
  });
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
