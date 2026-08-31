import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { enquiries, enquiryFollowUps, type EnquiryStage, type EnquirySource } from "@/db/schema/enquiries";
import type { Ctx } from "@/lib/auth/context";
import { ENQUIRY_STAGE_TRANSITIONS } from "@/lib/enquiry-stage-graph";
import { createMember, enrolMember, type GuardianInput } from "@/lib/services/register";
import { transitionMemberStatus } from "@/lib/services/member-status";
import { nextMemberCode } from "@/lib/services/people";
import type { ConsentGrantInput } from "@/lib/services/consent";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

export type EnquiryRow = {
  id: string;
  fullName: string;
  phone: string | null;
  source: EnquirySource;
  stage: EnquiryStage;
  memberId: string | null;
  createdAt: Date;
};

// C-12 done-when: "a walk-in is captured in under thirty seconds" --
// three required fields (name, source) plus an optional phone. DOB,
// consent, guardian resolution all wait until a trial is actually
// booked (bookTrial) or the enquiry converts without one
// (convertEnquiry) -- neither is needed just to log that someone
// asked.
export async function createEnquiry(
  ctx: ActionCtx,
  input: { fullName: string; phone?: string; source: EnquirySource; notes?: string },
): Promise<EnquiryRow> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        tenantId: ctx.tenantId,
        fullName: input.fullName,
        phone: input.phone,
        source: input.source,
        notes: input.notes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    return {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      source: row.source as EnquirySource,
      stage: row.stage as EnquiryStage,
      memberId: row.memberId,
      createdAt: row.createdAt,
    };
  });
}

export async function listEnquiries(
  ctx: ActionCtx,
  filters: { stage?: EnquiryStage } = {},
): Promise<EnquiryRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)];
    if (filters.stage) conditions.push(eq(enquiries.stage, filters.stage));

    const rows = await tx
      .select()
      .from(enquiries)
      .where(and(...conditions))
      .orderBy(desc(enquiries.createdAt));

    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      source: row.source as EnquirySource,
      stage: row.stage as EnquiryStage,
      memberId: row.memberId,
      createdAt: row.createdAt,
    }));
  });
}

export type EnquiryDetail = EnquiryRow & {
  notes: string | null;
  trialBatchId: string | null;
  followUps: Array<{ id: string; dueAt: Date; note: string | null; doneAt: Date | null }>;
};

export async function getEnquiryDetail(
  ctx: ActionCtx,
  enquiryId: string,
): Promise<EnquiryDetail | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(enquiries)
      .where(and(eq(enquiries.id, enquiryId), eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)));
    if (!row) return null;

    const followUps = await tx
      .select({
        id: enquiryFollowUps.id,
        dueAt: enquiryFollowUps.dueAt,
        note: enquiryFollowUps.note,
        doneAt: enquiryFollowUps.doneAt,
      })
      .from(enquiryFollowUps)
      .where(and(eq(enquiryFollowUps.enquiryId, enquiryId), eq(enquiryFollowUps.tenantId, ctx.tenantId)))
      .orderBy(asc(enquiryFollowUps.dueAt));

    return {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      source: row.source as EnquirySource,
      stage: row.stage as EnquiryStage,
      memberId: row.memberId,
      createdAt: row.createdAt,
      notes: row.notes,
      trialBatchId: row.trialBatchId,
      followUps,
    };
  });
}

export type StageResult = { ok: true } | { ok: false; error: string };

// C-13: stage transitions follow the same allowed-graph shape C-08
// uses for member status (lib/enquiry-stage-graph.ts). Not itself
// audited to a separate history table -- unlike member status, this
// wasn't asked for, and updated_at/updated_by already say who touched
// it last.
export async function transitionEnquiryStage(
  ctx: ActionCtx,
  input: { enquiryId: string; toStage: EnquiryStage },
): Promise<StageResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [enquiry] = await tx
      .select({ stage: enquiries.stage })
      .from(enquiries)
      .where(and(eq(enquiries.id, input.enquiryId), eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)))
      .for("update");
    if (!enquiry) return { ok: false, error: "Enquiry not found." };

    const fromStage = enquiry.stage as EnquiryStage;
    const allowed = ENQUIRY_STAGE_TRANSITIONS[fromStage] ?? [];
    if (!allowed.includes(input.toStage)) {
      return { ok: false, error: `Cannot move an enquiry from ${fromStage} to ${input.toStage}.` };
    }

    await tx
      .update(enquiries)
      .set({ stage: input.toStage, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(enquiries.id, input.enquiryId));
    return { ok: true };
  });
}

export async function addFollowUp(
  ctx: ActionCtx,
  input: { enquiryId: string; dueAt: Date; note?: string },
): Promise<{ id: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(enquiryFollowUps)
      .values({
        tenantId: ctx.tenantId,
        enquiryId: input.enquiryId,
        dueAt: input.dueAt,
        note: input.note,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: enquiryFollowUps.id });
    return row;
  });
}

export async function completeFollowUp(
  ctx: ActionCtx,
  followUpId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: enquiryFollowUps.id })
      .from(enquiryFollowUps)
      .where(and(eq(enquiryFollowUps.id, followUpId), eq(enquiryFollowUps.tenantId, ctx.tenantId)));
    if (!row) return { ok: false, error: "Follow-up not found." };

    await tx
      .update(enquiryFollowUps)
      .set({ doneAt: new Date(), updatedBy: ctx.userId })
      .where(eq(enquiryFollowUps.id, followUpId));
    return { ok: true };
  });
}

export type OverdueFollowUp = {
  id: string;
  enquiryId: string;
  enquiryName: string;
  dueAt: Date;
  note: string | null;
};

// C-13 done-when: "overdue follow-ups surface on the owner dashboard."
export async function listOverdueFollowUps(ctx: ActionCtx): Promise<OverdueFollowUp[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: enquiryFollowUps.id,
        enquiryId: enquiryFollowUps.enquiryId,
        enquiryName: enquiries.fullName,
        dueAt: enquiryFollowUps.dueAt,
        note: enquiryFollowUps.note,
      })
      .from(enquiryFollowUps)
      .innerJoin(enquiries, eq(enquiries.id, enquiryFollowUps.enquiryId))
      .where(
        and(
          eq(enquiryFollowUps.tenantId, ctx.tenantId),
          isNull(enquiryFollowUps.doneAt),
          lt(enquiryFollowUps.dueAt, sql`now()`),
        ),
      )
      .orderBy(asc(enquiryFollowUps.dueAt)),
  );
}

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
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const enquiry = await withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ id: enquiries.id, stage: enquiries.stage, memberId: enquiries.memberId, fullName: enquiries.fullName, phone: enquiries.phone })
      .from(enquiries)
      .where(and(eq(enquiries.id, input.enquiryId), eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)))
      .then((r) => r[0]),
  );
  if (!enquiry) return { ok: false, error: "Enquiry not found." };
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
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const enquiry = await withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ id: enquiries.id, stage: enquiries.stage, memberId: enquiries.memberId, fullName: enquiries.fullName, phone: enquiries.phone })
      .from(enquiries)
      .where(and(eq(enquiries.id, input.enquiryId), eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)))
      .then((r) => r[0]),
  );
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
        .set({ memberId: created.memberId, stage: "converted", updatedAt: new Date(), updatedBy: ctx.userId })
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
    const rows = await tx
      .select({
        source: enquiries.source,
        total: sql<number>`count(*)::int`,
        converted: sql<number>`count(*) filter (where ${enquiries.stage} = 'converted')::int`,
      })
      .from(enquiries)
      .where(and(eq(enquiries.tenantId, ctx.tenantId), isNull(enquiries.deletedAt)))
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
