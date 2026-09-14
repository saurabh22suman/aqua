"use server";

import { z } from "zod";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import {
  assertImageAllowed,
  createPaymentQr,
  deletePaymentQr,
  listPaymentQrs,
  updatePaymentQr,
  type PaymentQrRow,
  type QrMutationResult,
} from "@/lib/services/payment-qrs";

// C-35 — payment QR actions. Standing preamble: (1) parse, (2)
// permission. Reads need settings.read (reception holds it); writes
// need settings.manage (owner/admin only).

const createFormInput = z.object({
  nickname: z.string().trim().min(1).max(60),
  kind: z.enum(["upi", "image"]),
  upiId: z.string().trim().max(120).optional(),
  payeeName: z.string().trim().max(120).optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  nickname: z.string().trim().min(1).max(60).optional(),
  upiId: z.string().trim().max(120).optional(),
  payeeName: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

const deleteInput = z.object({ id: z.string().uuid() });

export async function listPaymentQrsAction(): Promise<PaymentQrRow[]> {
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.read");
  return listPaymentQrs(ctx);
}

export async function createPaymentQrAction(
  _prev: unknown,
  formData: FormData,
): Promise<QrMutationResult> {
  // (1) parse
  const surface = createFormInput.safeParse({
    nickname: String(formData.get("nickname") ?? "").trim(),
    kind: String(formData.get("kind") ?? ""),
    upiId: String(formData.get("upiId") ?? "").trim() || undefined,
    payeeName: String(formData.get("payeeName") ?? "").trim() || undefined,
  });
  if (!surface.success) {
    return {
      ok: false,
      error: surface.error.issues[0]?.message ?? "Invalid QR input.",
    };
  }

  // (2) permission
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");

  // (3) read the upload (if any) and hand it to the service.
  let image: { data: Uint8Array; mime: string } | undefined;
  if (surface.data.kind === "image") {
    const raw = formData.get("image");
    if (!(raw instanceof File)) {
      return { ok: false, error: "Choose a QR image." };
    }
    const problem = assertImageAllowed(raw.type, raw.size);
    if (problem) return { ok: false, error: problem };
    image = {
      data: new Uint8Array(await raw.arrayBuffer()),
      mime: raw.type,
    };
  }

  return createPaymentQr(ctx, { ...surface.data, image });
}

export async function updatePaymentQrAction(
  raw: unknown,
): Promise<QrMutationResult> {
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid QR update." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  const { id, ...patch } = parsed.data;
  return updatePaymentQr(ctx, id, patch);
}

export async function deletePaymentQrAction(
  raw: unknown,
): Promise<QrMutationResult> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid QR reference." };
  }
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "settings.manage");
  return deletePaymentQr(ctx, parsed.data.id);
}
