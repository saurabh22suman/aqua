"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  getTerminology,
  updateTermOverride,
  clearTermOverride,
  type ClearTermOverrideResult,
  type GetTerminologyResult,
  type UpdateTermOverrideResult,
} from "@/lib/services/terminology";
import { TERM_KEYS, type TermKey } from "@/lib/terminology/keys";

// Phase 2.10 — server actions for the terminology editor.
//
// Read is open to any staff member (the closed-key resolver is
// pure — anyone can read the tenant's resolved vocabulary); the
// editor itself is management-only, matching 2.9's branding
// editor. A coach looking at the parent page or the register
// benefits from seeing the tenant's customised vocabulary
// without being able to change it.

export async function getTerminologyAction(): Promise<GetTerminologyResult> {
  const ctx = await requireDefaultCtx();
  return getTerminology({ tenantId: ctx.tenantId });
}

const setSchema = z.object({
  key: z.enum(TERM_KEYS),
  locale: z.literal("en"),
  one: z.string().trim().min(1, "Singular form can't be empty.").max(60),
  other: z.string().trim().min(1, "Plural form can't be empty.").max(60),
});

const clearSchema = z.object({
  key: z.enum(TERM_KEYS),
  locale: z.literal("en"),
});

export async function updateTermOverrideAction(
  input: unknown,
): Promise<UpdateTermOverrideResult> {
  // (1) parse
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  // (2) permission: management only
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return updateTermOverride(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}

export async function clearTermOverrideAction(
  input: { key: TermKey; locale: "en" },
): Promise<ClearTermOverrideResult> {
  const parsed = clearSchema.safeParse(input);
  if (!parsed.success) {
    return {
      kind: "error",
      code: "invalid",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const ctx = await requireDefaultCtx();
  assertManagement(ctx);
  return clearTermOverride(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
