import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { leaveTypes } from "@/db/schema/leave";
import { writeAudit } from "@/lib/audit/write";
import type { TenantId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-26 — leave types and their seeding. The migration backfilled the
// defaults for existing tenants; seedDefaultLeaveTypes() does the same
// for new tenants inside the provisioning transaction and for the
// dev/demo seeders.

export const DEFAULT_LEAVE_TYPES = [
  { name: "Casual", annualQuota: 12, isPaid: true },
  { name: "Sick", annualQuota: 8, isPaid: true },
  { name: "Unpaid", annualQuota: null, isPaid: false },
] as const;

export const leaveTypeInput = z.object({
  name: z.string().trim().min(1).max(60),
  annualQuota: z.number().int().min(0).max(366).nullish(),
  isPaid: z.boolean(),
});

export const leaveTypeUpdateInput = leaveTypeInput.extend({
  id: z.string().uuid(),
});

export type LeaveTypeRow = {
  id: string;
  name: string;
  annualQuota: number | null;
  isPaid: boolean;
};

export type LeaveTypeResult =
  | { ok: true; leaveTypeId: string }
  | { ok: false; error: string };

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid leave input.";
}

async function seedDefaultsOnTx(tx: TenantTx, tenantId: TenantId): Promise<void> {
  for (const preset of DEFAULT_LEAVE_TYPES) {
    await tx
      .insert(leaveTypes)
      .values({
        tenantId,
        name: preset.name,
        annualQuota: preset.annualQuota,
        isPaid: preset.isPaid,
      })
      .onConflictDoNothing({ target: [leaveTypes.tenantId, leaveTypes.name] });
  }
}

export async function seedDefaultLeaveTypes(
  tenantId: TenantId,
  tx?: TenantTx,
): Promise<void> {
  if (tx) return seedDefaultsOnTx(tx, tenantId);
  return withTenant(tenantId, (innerTx) => seedDefaultsOnTx(innerTx, tenantId));
}

export async function listLeaveTypes(ctx: ActionCtx): Promise<LeaveTypeRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    return tx
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        annualQuota: leaveTypes.annualQuota,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.tenantId, ctx.tenantId))
      .orderBy(asc(leaveTypes.name));
  });
}

export async function createLeaveType(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(leaveTypes)
        .values({
          tenantId: ctx.tenantId,
          name: input.name,
          annualQuota: input.annualQuota ?? null,
          isPaid: input.isPaid,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: leaveTypes.id });
    } catch (error) {
      if (pgErrorCode(error) === "23505") {
        return { ok: false, error: "A leave type with that name already exists." };
      }
      throw error;
    }
    if (!inserted) return { ok: false, error: "The leave type could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave_type.create",
      entityType: "leave_type",
      entityId: inserted.id,
      after: {
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
      },
    });
    return { ok: true, leaveTypeId: inserted.id };
  });
}

export async function updateLeaveType(
  ctx: ActionCtx,
  raw: unknown,
): Promise<LeaveTypeResult> {
  const parsed = leaveTypeUpdateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(leaveTypes)
      .where(
        and(eq(leaveTypes.id, input.id), eq(leaveTypes.tenantId, ctx.tenantId)),
      )
      .for("update");
    if (!existing) return { ok: false, error: "Leave type not found." };

    await tx
      .update(leaveTypes)
      .set({
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      })
      .where(
        and(eq(leaveTypes.id, input.id), eq(leaveTypes.tenantId, ctx.tenantId)),
      );

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "leave_type.update",
      entityType: "leave_type",
      entityId: input.id,
      before: {
        name: existing.name,
        annualQuota: existing.annualQuota,
        isPaid: existing.isPaid,
      },
      after: {
        name: input.name,
        annualQuota: input.annualQuota ?? null,
        isPaid: input.isPaid,
      },
    });
    return { ok: true, leaveTypeId: input.id };
  });
}

function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
