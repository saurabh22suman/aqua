import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import {
  membershipPlans,
  type MembershipPlanKind,
} from "@/db/schema/membership-plans";
import { planShapes } from "@/db/schema/preset-engine";
import { facilities } from "@/db/schema/preset-engine";
import { locations } from "@/db/schema/locations";
import { auditLog } from "@/db/schema/audit";
import { isUniqueViolation } from "@/lib/pg-errors";
import type { ActionCtx } from "@/lib/auth/context";

// C-29/C-29c — membership plans. Preset plan_shapes are templates; a
// template is activated by pricing it at a facility, optionally for a
// single activity (null = all-access/combo). Plan prices are
// GST-exclusive; the rate comes from billing.gst_rate_bp at invoice
// time (C-29b). Owners/admins manage plans; ops reuses this service.

export const MAX_PLAN_AMOUNT_PAISE = 100_000_000;

export type PlanKind = MembershipPlanKind;

export type PlanRow = {
  id: string;
  name: string;
  kind: PlanKind;
  durationDays: number | null;
  sessions: number | null;
  amountPaise: number;
  locationId: string;
  locationName: string;
  activityId: string | null;
  activityName: string | null;
  isActive: boolean;
  sourceShapeId: string | null;
  createdAt: string;
};

export type PlanTemplateRow = {
  shapeId: string;
  name: string;
  kind: "duration" | "sessions" | "term" | "per_session" | "drop_in";
  durationDays: number | null;
  sessions: number | null;
};

export type PlanMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const amountSchema = z.number().int().min(1).max(MAX_PLAN_AMOUNT_PAISE);
const nameSchema = z.string().trim().min(1).max(120);

export const activatePlanInput = z.object({
  shapeId: z.string().uuid(),
  locationId: z.string().uuid(),
  activityId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120).optional(),
  amountPaise: amountSchema,
});

export const createPlanInput = z
  .object({
    locationId: z.string().uuid(),
    activityId: z.string().uuid().optional(),
    name: nameSchema,
    // M-06 — term is duration-shaped; per_session and drop_in are
    // payload-free and billed through invoices (C-32).
    kind: z.enum([
      "duration",
      "term",
      "sessions",
      "one_time",
      "per_session",
      "drop_in",
    ]),
    durationDays: z.number().int().min(1).max(3650).optional(),
    sessions: z.number().int().min(1).max(10000).optional(),
    amountPaise: amountSchema,
  })
  .superRefine((value, ctx) => {
    if (
      (value.kind === "duration" || value.kind === "term") &&
      value.durationDays === undefined
    ) {
      ctx.addIssue({ path: ["durationDays"], code: "custom", message: "A duration or term plan needs its number of days." });
    }
    if (value.kind === "sessions" && value.sessions === undefined) {
      ctx.addIssue({ path: ["sessions"], code: "custom", message: "A session pack needs its session count." });
    }
    if (
      (value.kind === "one_time" ||
        value.kind === "per_session" ||
        value.kind === "drop_in") &&
      (value.durationDays !== undefined || value.sessions !== undefined)
    ) {
      ctx.addIssue({ path: ["kind"], code: "custom", message: "A one-time, per-session or drop-in plan has neither duration nor sessions." });
    }
  });

export const updatePlanInput = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  amountPaise: amountSchema.optional(),
  isActive: z.boolean().optional(),
});

export async function listPlans(
  ctx: ActionCtx,
  options: {
    includeInactive?: boolean;
    locationId?: string;
    activityId?: string;
  } = {},
): Promise<PlanRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [
      eq(membershipPlans.tenantId, ctx.tenantId),
      isNull(membershipPlans.deletedAt),
    ];
    if (!options.includeInactive) {
      conditions.push(eq(membershipPlans.isActive, true));
    }
    if (options.locationId) {
      conditions.push(eq(membershipPlans.locationId, options.locationId));
    }
    if (options.activityId) {
      conditions.push(
        or(
          eq(membershipPlans.activityId, options.activityId),
          isNull(membershipPlans.activityId),
        )!,
      );
    }
    const rows = await tx
      .select({
        plan: membershipPlans,
        locationName: locations.name,
        activityName: facilities.name,
      })
      .from(membershipPlans)
      .innerJoin(locations, eq(locations.id, membershipPlans.locationId))
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, membershipPlans.activityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        asc(locations.name),
        asc(facilities.name),
        asc(membershipPlans.name),
      );
    return rows.map(({ plan, locationName, activityName }) =>
      toPlanRow(plan, locationName, activityName),
    );
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
    return shapes.map((shape) => ({
      shapeId: shape.id,
      name: shape.name,
      kind: shape.kind as PlanTemplateRow["kind"],
      durationDays: shape.durationDays,
      sessions: shape.sessions,
    }));
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

    const scope = await resolvePlanScope(
      tx,
      ctx.tenantId,
      parsed.data.locationId,
      parsed.data.activityId,
    );
    if (!scope.ok) return scope;

    const existing = await tx
      .select({ id: membershipPlans.id })
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.tenantId, ctx.tenantId),
          eq(membershipPlans.locationId, parsed.data.locationId),
          parsed.data.activityId
            ? eq(membershipPlans.activityId, parsed.data.activityId)
            : isNull(membershipPlans.activityId),
          eq(membershipPlans.sourceShapeId, shape.id),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return {
        ok: false,
        error:
          "That template is already activated here — edit the plan instead.",
      };
    }

    let row: { id: string } | undefined;
    try {
      [row] = await tx
        .insert(membershipPlans)
        .values({
          tenantId: ctx.tenantId,
          locationId: parsed.data.locationId,
          activityId: parsed.data.activityId ?? null,
          name: parsed.data.name ?? shape.name,
          kind: shape.kind,
          durationDays: shape.durationDays,
          sessions: shape.sessions,
          amountPaise: BigInt(parsed.data.amountPaise),
          sourceShapeId: shape.id,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: membershipPlans.id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error:
            "That template is already activated here — edit the plan instead.",
        };
      }
      throw err;
    }
    if (!row) return { ok: false, error: "The plan could not be saved." };

    await writeAudit(tx, ctx, "membership_plan.activate", row.id, {
      fromShape: shape.name,
      locationId: parsed.data.locationId,
      activityId: parsed.data.activityId ?? null,
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
    const scope = await resolvePlanScope(
      tx,
      ctx.tenantId,
      parsed.data.locationId,
      parsed.data.activityId,
    );
    if (!scope.ok) return scope;

    const [row] = await tx
      .insert(membershipPlans)
      .values({
        tenantId: ctx.tenantId,
        locationId: parsed.data.locationId,
        activityId: parsed.data.activityId ?? null,
        name: parsed.data.name,
        kind: parsed.data.kind,
        durationDays:
          parsed.data.kind === "duration" || parsed.data.kind === "term"
            ? parsed.data.durationDays!
            : null,
        sessions:
          parsed.data.kind === "sessions" ? parsed.data.sessions! : null,
        amountPaise: BigInt(parsed.data.amountPaise),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: membershipPlans.id });
    if (!row) return { ok: false, error: "The plan could not be saved." };
    await writeAudit(tx, ctx, "membership_plan.create", row.id, {
      name: parsed.data.name,
      kind: parsed.data.kind,
      locationId: parsed.data.locationId,
      activityId: parsed.data.activityId ?? null,
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

// A plan's facility must exist and be live; an activity, when given,
// must be live and belong to that facility (kind is data, not a branch).
async function resolvePlanScope(
  tx: TenantTx,
  tenantId: Awaited<ActionCtx["tenantId"]>,
  locationId: string,
  activityId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const locationRows = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.id, locationId),
        eq(locations.tenantId, tenantId),
        isNull(locations.deletedAt),
      ),
    )
    .limit(1);
  if (!locationRows[0]) return { ok: false, error: "Facility not found." };

  if (activityId) {
    const activityRows = await tx
      .select({ id: facilities.id, locationId: facilities.locationId })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, activityId),
          eq(facilities.tenantId, tenantId),
          isNull(facilities.deletedAt),
        ),
      )
      .limit(1);
    const activity = activityRows[0];
    if (!activity) return { ok: false, error: "Activity not found." };
    if (activity.locationId !== locationId) {
      return {
        ok: false,
        error: "That activity belongs to a different facility.",
      };
    }
  }
  return { ok: true };
}

function toPlanRow(
  row: typeof membershipPlans.$inferSelect,
  locationName: string,
  activityName: string | null,
): PlanRow {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as PlanKind,
    durationDays: row.durationDays,
    sessions: row.sessions,
    amountPaise: Number(row.amountPaise),
    locationId: row.locationId,
    locationName,
    activityId: row.activityId,
    activityName,
    isActive: row.isActive,
    sourceShapeId: row.sourceShapeId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function writeAudit(
  tx: TenantTx,
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
