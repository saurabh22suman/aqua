import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { batches, programs, type Batch, type Program } from "@/db/schema/programs";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { generateSessions } from "@/lib/jobs/session-generator";
import type { ActionCtx } from "@/lib/auth/context";
import { asStaffId } from "@/lib/ids";

export async function listPrograms(ctx: ActionCtx): Promise<Program[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select()
      .from(programs)
      .where(and(eq(programs.tenantId, ctx.tenantId), isNull(programs.deletedAt)))
      .orderBy(programs.name),
  );
}

export async function createProgram(
  ctx: ActionCtx,
  input: { name: string; description?: string },
): Promise<Program> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [program] = await tx
      .insert(programs)
      .values({
        tenantId: ctx.tenantId,
        name: input.name,
        description: input.description,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    return program;
  });
}

// Known gap (logged as known gap, F2 audit response): batch-level
// coach conflict (G1) is enforced only at the FORM layer via
// `checkCoachConflictsAction` — this service does not call
// `detectCoachConflicts` itself. A direct POST to the action
// bypasses the warning. See docs/guard-path-matrix.md.
//
// F2 finding: this gap predates the audit. Out of scope for the
// reschedule-session fix; closing it requires a service-layer
// call to detectCoachConflicts in both createBatch and
// updateBatch (the matrix names the path).

// C-16 done-when: CRUD works. Refuses while a live batch still
// references the program rather than cascading -- an owner deleting a
// program by mistake with active batches under it gets a clear reason,
// not a silent orphaning of those batches' program_id.
export async function deleteProgram(
  ctx: ActionCtx,
  programId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [program] = await tx
      .select({ id: programs.id })
      .from(programs)
      .where(and(eq(programs.id, programId), eq(programs.tenantId, ctx.tenantId), isNull(programs.deletedAt)));
    if (!program) return { ok: false, error: "Program not found." };

    const liveBatches = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.programId, programId), eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)))
      .limit(1);
    if (liveBatches.length > 0) {
      return { ok: false, error: "This program still has active batches. Delete those first." };
    }

    await tx
      .update(programs)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(programs.id, programId));
    return { ok: true };
  });
}

export type BatchWithProgramName = Batch & { programName: string; coachName: string | null };

export async function listBatches(ctx: ActionCtx): Promise<BatchWithProgramName[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        id: batches.id,
        tenantId: batches.tenantId,
        programId: batches.programId,
        name: batches.name,
        capacity: batches.capacity,
        daysOfWeek: batches.daysOfWeek,
        startTime: batches.startTime,
        endTime: batches.endTime,
        coachId: batches.coachId,
        isSample: batches.isSample,
        deletedAt: batches.deletedAt,
        createdAt: batches.createdAt,
        updatedAt: batches.updatedAt,
        createdBy: batches.createdBy,
        updatedBy: batches.updatedBy,
        programName: programs.name,
        coachName: persons.fullName,
      })
      .from(batches)
      .innerJoin(programs, eq(programs.id, batches.programId))
      .leftJoin(staff, eq(staff.id, batches.coachId))
      .leftJoin(persons, eq(persons.id, staff.personId))
      .where(and(eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)))
      .orderBy(programs.name, batches.name),
  );
}

export async function createBatch(
  ctx: ActionCtx,
  input: {
    programId: string;
    name: string;
    capacity: number;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    coachId?: string;
  },
): Promise<BatchWithProgramName> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [batch] = await tx
      .insert(batches)
      .values({
        tenantId: ctx.tenantId,
        programId: input.programId,
        name: input.name,
        capacity: input.capacity,
        daysOfWeek: input.daysOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        coachId: input.coachId ? asStaffId(input.coachId) : undefined,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();

    const [program] = await tx
      .select({ name: programs.name })
      .from(programs)
      .where(eq(programs.id, input.programId));

    let coachName: string | null = null;
    if (input.coachId) {
      const [coach] = await tx
        .select({ fullName: persons.fullName })
        .from(staff)
        .innerJoin(persons, eq(persons.id, staff.personId))
        .where(eq(staff.id, asStaffId(input.coachId)));
      coachName = coach?.fullName ?? null;
    }

    // D2 — a batch with no sessions is an empty register the day
    // after it's created; nothing else materialises them until the
    // nightly sessions.generate job runs. Same function the job and
    // both seed scripts call (lib/jobs/session-generator.ts) — it
    // already re-scans every active batch and no-ops on rows that
    // exist (onConflictDoNothing), so calling it here is safe to
    // repeat on every batch creation, not just this one's rows.
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    await generateSessions(tx, ctx.tenantId, tenant.timezone);

    return { ...batch, programName: program.name, coachName };
  });
}

// C-17 completion: soft delete. Sessions already materialised for this
// batch are untouched (they're historical fact, not hidden), but
// generateSessions only selects batches with deleted_at is null, so no
// new ones are created; enrolMember (lib/services/register.ts) refuses
// new enrolments the same way.
export async function updateProgram(
  ctx: ActionCtx,
  input: { programId: string; name: string; description?: string },
): Promise<{ ok: true; program: Program } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [program] = await tx
      .update(programs)
      .set({
        name: input.name,
        description: input.description,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(programs.id, input.programId), eq(programs.tenantId, ctx.tenantId), isNull(programs.deletedAt)))
      .returning();
    if (!program) return { ok: false, error: "Program not found." };
    return { ok: true, program };
  });
}

// Known gap (logged as known gap, F2 audit response): batch-level
// coach conflict (G1) is form-only here too. See createBatch's
// comment and docs/guard-path-matrix.md.
export async function updateBatch(
  ctx: ActionCtx,
  input: {
    batchId: string;
    programId: string;
    name: string;
    capacity: number;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    coachId?: string;
  },
): Promise<{ ok: true; batch: BatchWithProgramName } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [batch] = await tx
      .update(batches)
      .set({
        programId: input.programId,
        name: input.name,
        capacity: input.capacity,
        daysOfWeek: input.daysOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        coachId: input.coachId ? asStaffId(input.coachId) : null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)))
      .returning();
    if (!batch) return { ok: false, error: "Batch not found." };

    const [program] = await tx
      .select({ name: programs.name })
      .from(programs)
      .where(eq(programs.id, input.programId));

    let coachName: string | null = null;
    if (input.coachId) {
      const [coach] = await tx
        .select({ fullName: persons.fullName })
        .from(staff)
        .innerJoin(persons, eq(persons.id, staff.personId))
        .where(eq(staff.id, asStaffId(input.coachId)));
      coachName = coach?.fullName ?? null;
    }

    return { ok: true, batch: { ...batch, programName: program.name, coachName } };
  });
}

export async function deleteBatch(
  ctx: ActionCtx,
  batchId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [batch] = await tx
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)));
    if (!batch) return { ok: false, error: "Batch not found." };

    await tx
      .update(batches)
      .set({ deletedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(batches.id, batchId));
    return { ok: true };
  });
}

export type CoachOption = { staffId: string; fullName: string };

export async function listCoaches(ctx: ActionCtx): Promise<CoachOption[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ staffId: staff.id, fullName: persons.fullName })
      .from(staff)
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(and(eq(staff.tenantId, ctx.tenantId), eq(staff.staffType, "coach"), isNull(staff.deletedAt)))
      .orderBy(persons.fullName),
  );
}
