"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  listStaff,
  createStaff,
  type StaffRow,
} from "@/lib/services/staff";

// Phase 3.5 — owner-side staff directory actions. Read is
// management-only — viewing who works at the academy is
// management metadata, not coach-visible. Both reads and
// writes run through the parse-then-permission preamble
// (standing rule).

const STAFF_TYPES = ["coach", "receptionist", "worker", "accountant"] as const;

const listInputSchema = z.object({
  staffType: z.enum(STAFF_TYPES).optional(),
});

export async function listStaffAction(raw: {
  staffType?: (typeof STAFF_TYPES)[number];
}): Promise<StaffRow[]> {
  const input = listInputSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return listStaff({ tenantId: ctx.tenantId, userId: ctx.userId }, input);
}

const createSchema = z.object({
  staffType: z.enum(STAFF_TYPES),
  // Either an existing person id, or a name (the "this person
  // is not yet in the system" branch).
  existingPersonId: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(200).optional(),
  employedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Employment start date must be a YYYY-MM-DD date.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
}).refine((data) => Boolean(data.existingPersonId) !== Boolean(data.fullName), {
  message: "Pick an existing person or enter a new name — not both.",
});

export type CreateStaffActionInput = z.input<typeof createSchema>;

export async function createStaffAction(
  input: unknown,
): Promise<
  | { kind: "ok"; staffId: string }
  | { kind: "error"; code: "invalid" | "conflict" | "not_found"; message: string }
> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  const result = await createStaff(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data.existingPersonId
      ? {
          existingPersonId: parsed.data.existingPersonId,
          staffType: parsed.data.staffType,
          employedOn: parsed.data.employedOn,
        }
      : {
          fullName: parsed.data.fullName!,
          staffType: parsed.data.staffType,
          employedOn: parsed.data.employedOn,
        },
  );
  if (result.ok) return { kind: "ok", staffId: result.staffId };
  if (/already has a staff record/i.test(result.error)) {
    return { kind: "error", code: "conflict", message: result.error };
  }
  if (/person not found/i.test(result.error)) {
    return { kind: "error", code: "not_found", message: result.error };
  }
  return { kind: "error", code: "invalid", message: result.error };
}
