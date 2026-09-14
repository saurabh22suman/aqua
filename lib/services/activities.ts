import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { facilities, facilitySubUnits } from "@/db/schema/preset-engine";
import { locations } from "@/db/schema/locations";
import { auditLog } from "@/db/schema/audit";
import { isUniqueViolation } from "@/lib/pg-errors";
import { ACTIVITY_KINDS, type ActivityKind } from "@/lib/activities";
import type { ActionCtx } from "@/lib/auth/context";

// Activity catalog (decision 2026-09-14) — "activities" are what the
// schema calls `facilities`: a pool, court, table or café counter under
// a location (the site a user calls a facility). Owners/admins manage
// them here; ops uses the same service from the ops console. This is
// the catalog only — bookings are V-01.

export type ActivitySubUnit = { id: string; name: string };

export type ActivityRow = {
  id: string;
  locationId: string;
  locationName: string;
  name: string;
  kind: ActivityKind;
  capacity: number;
  isSample: boolean;
  subUnits: ActivitySubUnit[];
  createdAt: string;
};

export type ActivityMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const nameSchema = z.string().trim().min(1).max(80);
const capacitySchema = z.number().int().min(1).max(10000);
const kindSchema = z.enum(ACTIVITY_KINDS);
const subUnitNameSchema = z.string().trim().min(1).max(60);

export const createActivityInput = z.object({
  locationId: z.string().uuid(),
  name: nameSchema,
  kind: kindSchema,
  capacity: capacitySchema,
  subUnits: z.array(subUnitNameSchema).max(200).optional(),
});

export const updateActivityInput = z.object({
  id: z.string().uuid(),
  name: nameSchema.optional(),
  kind: kindSchema.optional(),
  capacity: capacitySchema.optional(),
});

export const addSubUnitInput = z.object({
  activityId: z.string().uuid(),
  name: subUnitNameSchema,
});

export const subUnitIdInput = z.object({ id: z.string().uuid() });

export async function listActivities(
  ctx: ActionCtx,
  options: { locationId?: string } = {},
): Promise<ActivityRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [
      eq(facilities.tenantId, ctx.tenantId),
      isNull(facilities.deletedAt),
    ];
    if (options.locationId) {
      conditions.push(eq(facilities.locationId, options.locationId));
    }
    const rows = await tx
      .select({
        id: facilities.id,
        locationId: facilities.locationId,
        locationName: locations.name,
        name: facilities.name,
        kind: facilities.kind,
        capacity: facilities.capacity,
        isSample: facilities.isSample,
        createdAt: facilities.createdAt,
      })
      .from(facilities)
      .innerJoin(locations, eq(locations.id, facilities.locationId))
      .where(and(...conditions))
      .orderBy(asc(locations.name), asc(facilities.name));

    const subUnits = await tx
      .select({
        id: facilitySubUnits.id,
        facilityId: facilitySubUnits.facilityId,
        name: facilitySubUnits.name,
      })
      .from(facilitySubUnits)
      .where(
        and(
          eq(facilitySubUnits.tenantId, ctx.tenantId),
          isNull(facilitySubUnits.deletedAt),
        ),
      );
    const byActivity = new Map<string, ActivitySubUnit[]>();
    for (const unit of subUnits) {
      const list = byActivity.get(unit.facilityId) ?? [];
      list.push({ id: unit.id, name: unit.name });
      byActivity.set(unit.facilityId, list);
    }

    return rows.map((row) => ({
      id: row.id,
      locationId: row.locationId,
      locationName: row.locationName,
      name: row.name,
      kind: row.kind as ActivityKind,
      capacity: row.capacity,
      isSample: row.isSample,
      subUnits: byActivity.get(row.id) ?? [],
      createdAt: row.createdAt.toISOString(),
    }));
  });
}

export async function createActivity(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = createActivityInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid activity.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const locationRows = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.id, parsed.data.locationId),
          eq(locations.tenantId, ctx.tenantId),
          isNull(locations.deletedAt),
        ),
      )
      .limit(1);
    if (!locationRows[0]) {
      return { ok: false, error: "Facility not found." };
    }

    try {
      const [row] = await tx
        .insert(facilities)
        .values({
          tenantId: ctx.tenantId,
          locationId: parsed.data.locationId,
          name: parsed.data.name,
          kind: parsed.data.kind,
          capacity: parsed.data.capacity,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: facilities.id });
      if (!row) return { ok: false, error: "The activity could not be saved." };

      const names = dedupe(parsed.data.subUnits ?? []);
      for (const name of names) {
        await tx.insert(facilitySubUnits).values({
          tenantId: ctx.tenantId,
          facilityId: row.id,
          name,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        });
      }

      await writeAudit(tx, ctx, "activity.create", row.id, {
        locationId: parsed.data.locationId,
        name: parsed.data.name,
        kind: parsed.data.kind,
        subUnits: names.length,
      });
      return { ok: true, id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "An activity with that name already exists at this facility.",
        };
      }
      throw err;
    }
  });
}

export async function updateActivity(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = updateActivityInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid activity update.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const { id, ...patch } = parsed.data;
    const set: Partial<typeof facilities.$inferInsert> = {
      ...patch,
      updatedAt: new Date(),
      updatedBy: ctx.userId,
    };
    try {
      const rows = await tx
        .update(facilities)
        .set(set)
        .where(
          and(
            eq(facilities.id, id),
            eq(facilities.tenantId, ctx.tenantId),
            isNull(facilities.deletedAt),
          ),
        )
        .returning({ id: facilities.id });
      if (!rows[0]) return { ok: false, error: "Activity not found." };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return {
          ok: false,
          error: "An activity with that name already exists at this facility.",
        };
      }
      throw err;
    }
    await writeAudit(tx, ctx, "activity.update", id, {
      fields: Object.keys(patch),
    });
    return { ok: true, id };
  });
}

export async function deleteActivity(
  ctx: ActionCtx,
  activityId: string,
): Promise<ActivityMutationResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(facilities)
      .set({ deletedAt: now, updatedAt: now, updatedBy: ctx.userId })
      .where(
        and(
          eq(facilities.id, activityId),
          eq(facilities.tenantId, ctx.tenantId),
          isNull(facilities.deletedAt),
        ),
      )
      .returning({ id: facilities.id });
    if (!rows[0]) return { ok: false, error: "Activity not found." };

    // Retire its sub-units with it; plans (C-29) keep the reference
    // for history.
    await tx
      .update(facilitySubUnits)
      .set({ deletedAt: now, updatedAt: now, updatedBy: ctx.userId })
      .where(
        and(
          eq(facilitySubUnits.tenantId, ctx.tenantId),
          eq(facilitySubUnits.facilityId, activityId),
          isNull(facilitySubUnits.deletedAt),
        ),
      );

    await writeAudit(tx, ctx, "activity.delete", activityId, {});
    return { ok: true, id: activityId };
  });
}

export async function addSubUnit(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = addSubUnitInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid sub-unit.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const activityRows = await tx
      .select({ id: facilities.id })
      .from(facilities)
      .where(
        and(
          eq(facilities.id, parsed.data.activityId),
          eq(facilities.tenantId, ctx.tenantId),
          isNull(facilities.deletedAt),
        ),
      )
      .limit(1);
    if (!activityRows[0]) return { ok: false, error: "Activity not found." };

    try {
      const [row] = await tx
        .insert(facilitySubUnits)
        .values({
          tenantId: ctx.tenantId,
          facilityId: parsed.data.activityId,
          name: parsed.data.name,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: facilitySubUnits.id });
      if (!row) return { ok: false, error: "The sub-unit could not be saved." };
      await writeAudit(tx, ctx, "activity.subunit.add", row.id, {
        activityId: parsed.data.activityId,
        name: parsed.data.name,
      });
      return { ok: true, id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        return { ok: false, error: "That sub-unit already exists." };
      }
      throw err;
    }
  });
}

export async function removeSubUnit(
  ctx: ActionCtx,
  raw: unknown,
): Promise<ActivityMutationResult> {
  const parsed = subUnitIdInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid sub-unit reference." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .update(facilitySubUnits)
      .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId })
      .where(
        and(
          eq(facilitySubUnits.id, parsed.data.id),
          eq(facilitySubUnits.tenantId, ctx.tenantId),
          isNull(facilitySubUnits.deletedAt),
        ),
      )
      .returning({ id: facilitySubUnits.id });
    if (!rows[0]) return { ok: false, error: "Sub-unit not found." };
    await writeAudit(tx, ctx, "activity.subunit.remove", parsed.data.id, {});
    return { ok: true, id: parsed.data.id };
  });
}

function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
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
    entityType: "activity",
    entityId,
    after,
  });
}
