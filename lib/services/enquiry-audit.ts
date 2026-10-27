import type { TenantTx } from "@/db/tenant";
import type { ActionCtx } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit/write";

// The enquiry family's audit contract (docs/architecture.md §8.10:
// "Written for every mutation, in the same transaction as the change").
//
// C-13's original note said the pipeline was "not itself audited to a
// separate history table -- unlike member status, this wasn't asked
// for, and updated_at/updated_by already say who touched it last".
// That reasoning is superseded: there is no separate history table,
// and updated_by names only the LAST editor, not the accountable
// history. Every enquiry mutation writes its audit row through the
// ONE writer (lib/audit/write.ts) inside the SAME transaction as the
// domain write, so a change can never succeed without its record.
//
// What the payloads carry: identifiers and STATE (stage, source,
// location, due date, member link). What they never carry: the
// enquiry's personal data -- no full name, no phone, no notes, no
// guardian details. The audit trail answers "who changed this, when
// and how"; it is not a second copy of the enquiry.

// The actor model, exactly as lib/services/member-status.ts applies
// it: a request-scoped caller is a "user", an internal/system caller
// with no actor id is a "system". There is no impersonation context
// on ActionCtx yet, so impersonator_id stays NULL (writeAudit's
// default) — the same as every other tenant-side caller.
function actorOf(ctx: ActionCtx) {
  return {
    actorId: ctx.userId ?? null,
    actorType: ctx.userId ? ("user" as const) : ("system" as const),
    requestId: ctx.requestId,
  };
}

// The changed-field list is derived from the payload that is actually
// written, so it can never drift from before/after.
function changedFieldsOf(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter((key) => !Object.is(before[key], after[key]));
}

export async function auditEnquiryCreated(
  tx: TenantTx,
  ctx: ActionCtx,
  enquiry: { id: string; source: string; stage: string; locationId: string | null },
): Promise<void> {
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    ...actorOf(ctx),
    action: "enquiry.create",
    entityType: "enquiry",
    entityId: enquiry.id,
    after: { stage: enquiry.stage, source: enquiry.source, locationId: enquiry.locationId },
  });
}

export async function auditEnquiryStageChanged(
  tx: TenantTx,
  ctx: ActionCtx,
  enquiry: { id: string; fromStage: string; toStage: string },
): Promise<void> {
  const before = { stage: enquiry.fromStage };
  const after = { stage: enquiry.toStage };
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    ...actorOf(ctx),
    action: "enquiry.stage",
    entityType: "enquiry",
    entityId: enquiry.id,
    before,
    after,
    changedFields: changedFieldsOf(before, after),
  });
}

export async function auditFollowUpCreated(
  tx: TenantTx,
  ctx: ActionCtx,
  followUp: { id: string; enquiryId: string; dueAt: Date },
): Promise<void> {
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    ...actorOf(ctx),
    action: "enquiry.follow_up.create",
    entityType: "enquiry_follow_up",
    entityId: followUp.id,
    after: { enquiryId: followUp.enquiryId, dueAt: followUp.dueAt.toISOString() },
  });
}

export async function auditFollowUpCompleted(
  tx: TenantTx,
  ctx: ActionCtx,
  followUp: { id: string; enquiryId: string; doneAt: Date },
): Promise<void> {
  const before = { doneAt: null as string | null };
  const after = { doneAt: followUp.doneAt.toISOString() };
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    ...actorOf(ctx),
    action: "enquiry.follow_up.complete",
    entityType: "enquiry_follow_up",
    entityId: followUp.id,
    before,
    after,
    changedFields: changedFieldsOf(before, after),
  });
}

// The enquiry's own state — the four fields the trail reports about
// it. Identifiers and stage only: never the name, phone, notes or
// guardian details.
export type EnquiryAuditState = {
  stage: string;
  memberId: string | null;
  trialBatchId: string | null;
  locationId: string | null;
};

// The state of an enquiry as it stands BEFORE the change. The caller
// spreads it and overrides only the fields the change touches, so the
// "before" and "after" of one audit row can never describe different
// fields.
export function enquiryAuditState(enquiry: EnquiryAuditState): EnquiryAuditState {
  return {
    stage: enquiry.stage,
    memberId: enquiry.memberId,
    trialBatchId: enquiry.trialBatchId,
    locationId: enquiry.locationId,
  };
}

// One state change of the enquiry itself: the trial booking (C-14)
// and the conversion (C-15). The member's own creation, enrolment
// and status change keep their OWN audit rows — this row is about
// what happened to the ENQUIRY, and never repeats them.
export async function auditEnquiryStateChanged(
  tx: TenantTx,
  ctx: ActionCtx,
  input: {
    action: "enquiry.trial_book" | "enquiry.convert";
    id: string;
    before: EnquiryAuditState;
    after: EnquiryAuditState;
  },
): Promise<void> {
  await writeAudit(tx, {
    tenantId: ctx.tenantId,
    ...actorOf(ctx),
    action: input.action,
    entityType: "enquiry",
    entityId: input.id,
    before: input.before,
    after: input.after,
    changedFields: changedFieldsOf(input.before, input.after),
  });
}
