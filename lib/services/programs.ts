import { eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { batches, programs, type Batch, type Program } from "@/db/schema/programs";
import type { Ctx } from "@/lib/auth/context";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

export async function listPrograms(ctx: ActionCtx): Promise<Program[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx.select().from(programs).where(eq(programs.tenantId, ctx.tenantId)).orderBy(programs.name),
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

export type BatchWithProgramName = Batch & { programName: string };

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
        deletedAt: batches.deletedAt,
        createdAt: batches.createdAt,
        updatedAt: batches.updatedAt,
        createdBy: batches.createdBy,
        updatedBy: batches.updatedBy,
        programName: programs.name,
      })
      .from(batches)
      .innerJoin(programs, eq(programs.id, batches.programId))
      .where(eq(batches.tenantId, ctx.tenantId))
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
  },
): Promise<Batch> {
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
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    return batch;
  });
}
