"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement, assertStaff } from "@/lib/auth/permissions";
import { createBatchSchema, createProgramSchema } from "@/lib/schemas";
import {
  createBatch,
  createProgram,
  listBatches,
  listPrograms,
  type BatchWithProgramName,
} from "@/lib/services/programs";
import type { Program } from "@/db/schema/programs";

export async function listProgramsAction(): Promise<Program[]> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listPrograms(ctx);
}

export async function createProgramAction(raw: {
  name: string;
  description?: string;
}): Promise<{ ok: true; program: Program } | { ok: false; error: string }> {
  const input = createProgramSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);

  const program = await createProgram(ctx, input);
  return { ok: true, program };
}

export async function listBatchesAction(): Promise<BatchWithProgramName[]> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listBatches(ctx);
}

export async function createBatchAction(raw: {
  programId: string;
  name: string;
  capacity: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = createBatchSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);

  await createBatch(ctx, input);
  return { ok: true };
}
