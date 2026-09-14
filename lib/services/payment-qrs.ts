import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { paymentQrs } from "@/db/schema/payment-qrs";
import { auditLog } from "@/db/schema/audit";
import { isUniqueViolation } from "@/lib/pg-errors";
import type { ActionCtx } from "@/lib/auth/context";
import {
  PAYMENT_QR_IMAGE_MAX_BYTES,
  PAYMENT_QR_IMAGE_MIMES,
  type PaymentQrKind,
} from "@/lib/payment-qr";

// C-35 (payment gateway decision, 2026-09-14) — owner payment QRs.
// Owners/admins manage them; reception reads them (the collect screen).
// Images are small and stored in Postgres; see the migration.

export type PaymentQrRow = {
  id: string;
  nickname: string;
  kind: PaymentQrKind;
  upiId: string | null;
  payeeName: string | null;
  imageMime: string | null;
  hasImage: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type QrMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const nicknameSchema = z.string().trim().min(1).max(60);
const payeeNameSchema = z.string().trim().min(1).max(120);
export const upiIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9.\-_]*@[a-zA-Z][a-zA-Z]{1,63}$/,
    "That doesn't look like a UPI ID (name@bank).",
  );

export function assertImageAllowed(mime: string, size: number): string | null {
  if (!(PAYMENT_QR_IMAGE_MIMES as readonly string[]).includes(mime)) {
    return "Use a PNG, JPEG or WebP image.";
  }
  if (size <= 0 || size > PAYMENT_QR_IMAGE_MAX_BYTES) {
    return "The image must be 256 KB or smaller.";
  }
  return null;
}

function toRow(row: {
  id: string;
  nickname: string;
  kind: string;
  upiId: string | null;
  payeeName: string | null;
  imageMime: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}): PaymentQrRow {
  return {
    id: row.id,
    nickname: row.nickname,
    kind: row.kind as PaymentQrKind,
    upiId: row.upiId,
    payeeName: row.payeeName,
    imageMime: row.imageMime,
    hasImage: row.imageMime !== null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPaymentQrs(
  ctx: ActionCtx,
  options: { activeOnly?: boolean } = {},
): Promise<PaymentQrRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [
      eq(paymentQrs.tenantId, ctx.tenantId),
      isNull(paymentQrs.deletedAt),
    ];
    if (options.activeOnly) conditions.push(eq(paymentQrs.isActive, true));
    const rows = await tx
      .select({
        id: paymentQrs.id,
        nickname: paymentQrs.nickname,
        kind: paymentQrs.kind,
        upiId: paymentQrs.upiId,
        payeeName: paymentQrs.payeeName,
        imageMime: paymentQrs.imageMime,
        isActive: paymentQrs.isActive,
        sortOrder: paymentQrs.sortOrder,
        createdAt: paymentQrs.createdAt,
      })
      .from(paymentQrs)
      .where(and(...conditions))
      .orderBy(asc(paymentQrs.sortOrder), asc(paymentQrs.createdAt));
    return rows.map(toRow);
  });
}

export async function createPaymentQr(
  ctx: ActionCtx,
  input: {
    nickname: string;
    kind: PaymentQrKind;
    upiId?: string;
    payeeName?: string;
    image?: { data: Uint8Array; mime: string };
  },
): Promise<QrMutationResult> {
  const nickname = nicknameSchema.safeParse(input.nickname);
  if (!nickname.success) {
    return { ok: false, error: "Give the QR a nickname (up to 60 characters)." };
  }

  let upiId: string | null = null;
  let payeeName: string | null = null;
  let imageData: Buffer | null = null;
  let imageMime: string | null = null;
  let imageSize: number | null = null;

  if (input.kind === "upi") {
    const parsedUpi = upiIdSchema.safeParse(input.upiId ?? "");
    const parsedPayee = payeeNameSchema.safeParse(input.payeeName ?? "");
    if (!parsedUpi.success) {
      return { ok: false, error: parsedUpi.error.issues[0]!.message };
    }
    if (!parsedPayee.success) {
      return { ok: false, error: "Enter the payee name shown in the UPI app." };
    }
    upiId = parsedUpi.data;
    payeeName = parsedPayee.data;
  } else {
    if (!input.image) return { ok: false, error: "Choose a QR image." };
    const problem = assertImageAllowed(input.image.mime, input.image.data.byteLength);
    if (problem) return { ok: false, error: problem };
    imageData = Buffer.from(input.image.data);
    imageMime = input.image.mime;
    imageSize = imageData.byteLength;
  }

  return withTenant(ctx.tenantId, async (tx) => {
    try {
      const [row] = await tx
        .insert(paymentQrs)
        .values({
          tenantId: ctx.tenantId,
          nickname: nickname.data,
          kind: input.kind,
          upiId,
          payeeName,
          imageData,
          imageMime,
          imageSize,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: paymentQrs.id });
      if (!row) return { ok: false, error: "The QR could not be saved." };
      await writeAudit(tx, ctx, "payment_qr.create", row.id, {
        nickname: nickname.data,
        kind: input.kind,
      });
      return { ok: true, id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, error: "That nickname is already used." };
      }
      throw err;
    }
  });
}

export async function updatePaymentQr(
  ctx: ActionCtx,
  id: string,
  input: {
    nickname?: string;
    upiId?: string;
    payeeName?: string;
    isActive?: boolean;
    sortOrder?: number;
  },
): Promise<QrMutationResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: paymentQrs.id, kind: paymentQrs.kind })
      .from(paymentQrs)
      .where(
        and(
          eq(paymentQrs.id, id),
          eq(paymentQrs.tenantId, ctx.tenantId),
          isNull(paymentQrs.deletedAt),
        ),
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) return { ok: false, error: "QR not found." };

    const patch: Partial<typeof paymentQrs.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };

    if (input.nickname !== undefined) {
      const parsed = nicknameSchema.safeParse(input.nickname);
      if (!parsed.success) {
        return { ok: false, error: "Give the QR a nickname (up to 60 characters)." };
      }
      patch.nickname = parsed.data;
    }
    if (input.isActive !== undefined) patch.isActive = input.isActive;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

    if (existing.kind === "upi") {
      if (input.upiId !== undefined) {
        const parsed = upiIdSchema.safeParse(input.upiId);
        if (!parsed.success) {
          return { ok: false, error: parsed.error.issues[0]!.message };
        }
        patch.upiId = parsed.data;
      }
      if (input.payeeName !== undefined) {
        const parsed = payeeNameSchema.safeParse(input.payeeName);
        if (!parsed.success) {
          return { ok: false, error: "Enter the payee name shown in the UPI app." };
        }
        patch.payeeName = parsed.data;
      }
    } else if (input.upiId !== undefined || input.payeeName !== undefined) {
      return {
        ok: false,
        error: "An image QR has no UPI ID; delete and re-add it to change kind.",
      };
    }

    try {
      await tx
        .update(paymentQrs)
        .set(patch)
        .where(
          and(eq(paymentQrs.id, id), eq(paymentQrs.tenantId, ctx.tenantId)),
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, error: "That nickname is already used." };
      }
      throw err;
    }
    await writeAudit(tx, ctx, "payment_qr.update", id, {
      fields: Object.keys(patch).filter(
        (k) => k !== "updatedAt" && k !== "updatedBy",
      ),
      isActive: patch.isActive ?? null,
    });
    return { ok: true, id };
  });
}

export async function deletePaymentQr(
  ctx: ActionCtx,
  id: string,
): Promise<QrMutationResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .update(paymentQrs)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(paymentQrs.id, id),
          eq(paymentQrs.tenantId, ctx.tenantId),
          isNull(paymentQrs.deletedAt),
        ),
      )
      .returning({ id: paymentQrs.id });
    if (!rows[0]) return { ok: false, error: "QR not found." };
    await writeAudit(tx, ctx, "payment_qr.delete", id, {});
    return { ok: true, id };
  });
}

export async function getPaymentQrImage(
  ctx: ActionCtx,
  id: string,
): Promise<{ data: Buffer; mime: string } | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ data: paymentQrs.imageData, mime: paymentQrs.imageMime })
      .from(paymentQrs)
      .where(
        and(
          eq(paymentQrs.id, id),
          eq(paymentQrs.tenantId, ctx.tenantId),
          isNull(paymentQrs.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row?.data || !row.mime) return null;
    return { data: row.data, mime: row.mime };
  });
}

type AuditTx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function writeAudit(
  tx: AuditTx,
  ctx: ActionCtx,
  action: string,
  entityId: string,
  after: Record<string, unknown>,
): Promise<void> {
  if (!ctx.userId) return;
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    action,
    entityType: "payment_qr",
    entityId,
    after,
  });
}
