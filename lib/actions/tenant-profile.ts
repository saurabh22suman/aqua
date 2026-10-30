"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getTenantProfile,
  SUPPORTED_CURRENCY,
  UNSUPPORTED_CURRENCY_MESSAGE,
  updateTenantProfile,
  type TenantProfile,
  type UpdateTenantProfileResult,
} from "@/lib/services/tenant-profile";

// PR2-C1 — academy profile actions. Standing preamble: (1) Zod parse,
// (2) permission check, (3) service. Reads ride settings.read (any
// staff member can see the academy identity); writes are
// management-only, matching branding and terminology.
//
// Currency is INR-only in this release. The action refuses an explicit
// unsupported code before the permission/service call (no mutation, no
// success audit). `currency` is optional so a read-only editor can omit
// it for an existing non-INR tenant and still save the other fields;
// the stored value is left untouched, never silently rewritten to INR.

export async function getTenantProfileAction(): Promise<TenantProfile | null> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return getTenantProfile(ctx);
}

const updateFormSchema = z.object({
  name: z.string().trim().min(1, "Academy name can't be empty.").max(200),
  currency: z
    .string()
    .trim()
    .refine(
      (value) => value === SUPPORTED_CURRENCY,
      UNSUPPORTED_CURRENCY_MESSAGE,
    )
    .optional(),
  timezone: z.string().trim().min(1, "Time zone is required.").max(60),
  gstin: z.string().trim().max(15, "GSTIN is at most 15 characters."),
});

export type UpdateTenantProfileActionInput = z.input<typeof updateFormSchema>;

export async function updateTenantProfileAction(
  input: unknown,
): Promise<UpdateTenantProfileResult> {
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
  requirePermission(ctx, "settings.manage");
  return updateTenantProfile(ctx, parsed.data);
}
