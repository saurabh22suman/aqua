"use server";

import { requireCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import {
  createMemberSchema,
  enrolSchema,
  markAttendanceSchema,
} from "@/lib/schemas";
import {
  createMember,
  enrolMember,
  markAttendance,
} from "@/lib/services/register";

export async function createMemberAction(slug: string, raw: unknown) {
  const input = createMemberSchema.parse(raw);
  const ctx = await requireCtx(slug);
  assertStaff(ctx);
  return createMember(ctx, input);
}

export async function enrolAction(slug: string, raw: unknown) {
  const input = enrolSchema.parse(raw);
  const ctx = await requireCtx(slug);
  assertStaff(ctx);
  return enrolMember(ctx, input);
}

export async function markAttendanceAction(slug: string, raw: unknown) {
  const input = markAttendanceSchema.parse(raw);
  const ctx = await requireCtx(slug);
  assertStaff(ctx);
  return markAttendance(ctx, input);
}
