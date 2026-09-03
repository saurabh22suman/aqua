"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertManagement } from "@/lib/auth/permissions";
import {
  getBranding,
  updateBranding,
  type BrandingData,
  type UpdateBrandingResult,
} from "@/lib/services/branding";
import { ACCENT_KEYS } from "@/lib/branding/accents";

// Phase 2.9 — owner-side branding actions.
//
// parse-then-permission preamble (the standing rule). The service
// parses a second time as a defence-in-depth check; the action's
// parse is the boundary test the standing rule asserts.
//
// Update is management-only: a coach or receptionist shouldn't be
// able to rename the academy from inside their app.

export async function getBrandingAction(): Promise<BrandingData> {
  const ctx = await requireDefaultCtx();
  return getBranding({ tenantId: ctx.tenantId });
}

const updateFormSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Display name can't be empty.")
    .max(200, "Display name is too long.")
    .optional(),
  shortName: z
    .string()
    .trim()
    .min(1, "Short name can't be empty — it's what the initials mark is built from.")
    .max(40, "Short name is too long.")
    .optional(),
  accent: z.enum(ACCENT_KEYS).optional(),
});

export type UpdateBrandingActionInput = z.input<typeof updateFormSchema>;

export async function updateBrandingAction(
  input: unknown,
): Promise<UpdateBrandingResult> {
  // (1) parse
  const parsed = updateFormSchema.safeParse(input);
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
  return updateBranding(
    { tenantId: ctx.tenantId, userId: ctx.userId },
    parsed.data,
  );
}
