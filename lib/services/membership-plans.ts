import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import {
  membershipPlans,
  type MembershipPlanKind,
} from "@/db/schema/membership-plans";
import { planShapes } from "@/db/schema/preset-engine";
import { auditLog } from "@/db/schema/audit";
import { isUniqueViolation } from "@/lib/pg-errors";
import type { ActionCtx } from "@/lib/auth/context";

// C-29 — membership plans. Preset plan_shapes are templates; a template
// is activated by pricing it, which creates a membership_plans row.
// Owners/admins manage plans (settings.manage at the action layer).

// ₹10,00,000 — a sanity ceiling, not a business rule.
export const MAX_PLAN_AMOUNT_PAISE = 100_000_000;

export type PlanKind = MembershipPlanKind;

export type PlanRow = {
  id: string;
  name: string;
  kind: PlanKind;
  durationDays: number | null;
  sessions: number | null;
  amountPaise: number;
  taxRateBp: number;
  isActive: boolean;
  sourceShapeId: string | null;
  createdAt: string;
};

export type PlanTemplateRow = {
  shapeId: string;
  name: string;
  kind: "duration" | "sessions";
  durationDays: number | null;
  sessions: number | null;
  activatedPlanId: string | null;
  activatedAmountPaise: number | null;
};

export type PlanMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const amountSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PLAN_AMOUNT_PAISE);
const taxSchema = z.number().int().min(0).max(10000);
const nameSchema = z.string().trim().min(1).max(120);

export const activatePlanInput = z.object({
  shapeId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  amountPaise: amountSchema,
  taxRateBp: taxSchema.optional(),
});

export const createPlanInput = z
  .object({
    name: nameSchema,
    kind: z.enum(["duration", "sessions", "one_time"]),
    durationDays: z.number().int().min(1).max(3650).optional(),
    sessions: z.number().int().min(1).max(10000).optional(),
    amountPaise: amountSchema,
    taxRateBp: taxSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "duration" && value.durationDays === undefined) {
      ctx.addIssue({ path: ["durationDays"], code: "custom", message: "A duration plan needs its number of days." });
    }
    if (value.kind === "sessions" && value.sessions === undefined) {
      ctx.addIssue({ path: ["sessions"], code: "custom", message: "A session pack needs its session count." });
    }
    if (value.kind === "one_time" && (value.durationDays !== undefined || value.sessions !== undefined)) {
      ctx.addIssue({ path: ["kind"], code: "custom", message: "A one-time plan has neither duration nor sessions." });
    }
  });

export const updatePlanInput = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  amountPaise: amountSchema.optional(),
  taxRateBp: taxSchema.optional(),
  isActive: z.boolean().optional(),
});

export async function listPlans(
  ctx: ActionCtx,
  options: { includeInactive?: boolean } = {},
): Promise<PlanRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [
      eq(membershipPlans.tenantId, ctx.tenantId),
      isNull(membershipPlans.deletedAt),
    ];
    if (!options.includeInactive) {
      conditions.push(eq(membershipPlans.isActive, true));
    }
    const rows = await tx
      .select()
      .from(membershipPlans)
      .where(and(...conditions))
      .orderBy(asc(membershipPlans.name));
    return rows.map(toPlanRow);
  });
}

export async function listPlanTemplates(
  ctx: ActionCtx,
): Promise<PlanTemplateRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const shapes = await tx
      .select()
      .from(planShapes)
      .where(eq(planShapes.tenantId, ctx.tenantId))
      .orderBy(asc(planShapes.name));
    const plans = await tx
      .select({
        id: membershipPlans.id,
        amountPaise: membershipPlans.amountPaise,
        sourceShapeId: membershipPlans.sourceShapeId,
      })
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.tenantId, ctx.tenantId),
          isNull(membershipPlans.deletedAt),
        ),
      );
    const byShape = new Map(
      plans
        .filter((p) => p.sourceShapeId !== null)
        .map((p) => [p.sourceShapeId as string, p]),
    );
    return shapes.map((shape) => {
      const plan = byShape.get(shape.id);
      return {
        shapeId: shape.id,
        name: shape.name,
        kind: shape.kind as "duration" | "sessions",
        durationDays: shape.durationDays,
        sessions: shape.sessions,
        activatedPlanId: plan?.id ?? null,
        activatedAmountPaise:
          plan !== undefined ? Number(plan.amountPaise) : null,
      };
    });
  });
}

export async function activatePlanFromShape(
  ctx: ActionCtx,
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = activatePlanInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid plan price.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const shapeRows = await tx
      .select()
      .from(planShapes)
      .where(
        and(
          eq(planShapes.id, parsed.data.shapeId),
          eq(planShapes.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const shape = shapeRows[0];
    if (!shape) return { ok: false, error: "Plan template not found." };

    const existing = await tx
      .select({ id: membershipPlans.id })
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.tenantId, ctx.tenantId),
          eq(membershipPlans.sourceShapeId, shape.id),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return {
        ok: false,
        error: "That template is already activated — edit the plan instead.",
      };
    }

    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(membershipPlans)
        .values({
          tenantId: ctx.tenantId,
          name: parsed.data.name ?? shape.name,
          kind: shape.kind,
          durationDays: shape.durationDays,
          sessions: shape.sessions,
          amountPaise: BigInt(parsed.data.amountPaise),
          taxRateBp: parsed.data.taxRateBp ?? 1800,
          sourceShapeId: shape.id,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: membershipPlans.id });
    } catch (err) {
      // The partial unique index is the race-proof half of the
      // check above: two concurrent activations, one friendly error.
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "That template is already activated — edit the plan instead.",
        };
      }
      throw err;
    }
    if (!row) return { ok: false, error: "The plan could not be saved." };

    await writeAudit(tx, ctx, "membership_plan.activate", row.id, {
      fromShape: shape.name,
      amountPaise: parsed.data.amountPaise,
    });
    return { ok: true, id: row.id };
  });
}

export async function createPlan(
  ctx: ActionCtx,
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = createPlanInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid plan.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(membershipPlans)
      .values({
        tenantId: ctx.tenantId,
        name: parsed.data.name,
        kind: parsed.data.kind,
        durationDays:
          parsed.data.kind === "duration" ? parsed.data.durationDays! : null,
        sessions:
          parsed.data.kind === "sessions" ? parsed.data.sessions! : null,
        amountPaise: BigInt(parsed.data.amountPaise),
        taxRateBp: parsed.data.taxRateBp ?? 1800,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: membershipPlans.id });
    if (!row) return { ok: false, error: "The plan could not be saved." };
    await writeAudit(tx, ctx, "membership_plan.create", row.id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      amountPaise: parsed.data.amountPaise,
    });
    return { ok: true, id: row.id };
  });
}

export async function updatePlan(
  ctx: ActionCtx,
  raw: unknown,
): Promise<PlanMutationResult> {
  const parsed = updatePlanInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid plan update.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const { id, amountPaise, ...rest } = parsed.data;
    const patch: Partial<typeof membershipPlans.$inferInsert> = {
      ...rest,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };
    if (amountPaise !== undefined) patch.amountPaise = BigInt(amountPaise);

    const rows = await tx
      .update(membershipPlans)
      .set(patch)
      .where(
        and(
          eq(membershipPlans.id, id),
          eq(membershipPlans.tenantId, ctx.tenantId),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .returning({ id: membershipPlans.id });
    if (!rows[0]) return { ok: false, error: "Plan not found." };
    await writeAudit(tx, ctx, "membership_plan.update", id, {
      fields: Object.keys(patch).filter(
        (k) => k !== "updatedAt" && k !== "updatedBy",
      ),
    });
    return { ok: true, id };
  });
}

export async function archivePlan(
  ctx: ActionCtx,
  planId: string,
): Promise<PlanMutationResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .update(membershipPlans)
      .set({ isActive: false, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(membershipPlans.id, planId),
          eq(membershipPlans.tenantId, ctx.tenantId),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .returning({ id: membershipPlans.id });
    if (!rows[0]) return { ok: false, error: "Plan not found." };
    await writeAudit(tx, ctx, "membership_plan.archive", planId, {});
    return { ok: true, id: planId };
  });
}

function toPlanRow(row: {
  id: string;
  name: string;
  kind: string;
  durationDays: number | null;
  sessions: number | null;
  amountPaise: bigint;
  taxRateBp: number;
  isActive: boolean;
  sourceShapeId: string | null;
  createdAt: Date;
}): PlanRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PlanKind,
    durationDays: row.durationDays,
    sessions: row.sessions,
    amountPaise: Number(row.amountPaise),
    taxRateBp: row.taxRateBp,
    isActive: row.isActive,
    sourceShapeId: row.sourceShapeId,
    createdAt: row.createdAt.toISOString(),
  };
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function writeAudit(
  tx: Tx,
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
    entityType: "membership_plan",
    entityId,
    after,
  });
}
