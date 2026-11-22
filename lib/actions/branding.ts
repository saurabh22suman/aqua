"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  getBranding,
  updateBranding,
  uploadBrandingAsset,
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
}).strict();

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
  requirePermission(ctx, "settings.manage");
  return updateBranding(
    { tenantId: ctx.tenantId, userId: ctx.userId, requestId: ctx.requestId },
    parsed.data,
  );
}

const uploadFormSchema = z.object({
  kind: z.enum(["logo", "install_icon"]),
  file: z.custom<File>((value) => value instanceof File && value.size > 0 && value.size <= 750 * 1024 && ["image/png", "image/jpeg", "image/webp"].includes(value.type)),
  kindCount: z.literal(1),
  fileCount: z.literal(1),
});

export async function uploadBrandingAssetAction(form: FormData): Promise<{ ok: boolean }> {
  const parsed = uploadFormSchema.safeParse({ kind: form.get("kind"), file: form.get("file"), kindCount: form.getAll("kind").length, fileCount: form.getAll("file").length });
  if (!parsed.success) return { ok: false };
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return uploadBrandingAsset({ ctx, kind: parsed.data.kind, bytes: new Uint8Array(await parsed.data.file.arrayBuffer()), mime: parsed.data.file.type });
}
