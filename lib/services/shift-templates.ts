import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { shiftTemplates } from "@/db/schema/shifts";
import { writeAudit } from "@/lib/audit/write";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { normalizeWall, wallTime } from "@/lib/services/shift-time";
import type { ActionCtx } from "@/lib/auth/context";

// V-23 — shift templates: the named wall-time blocks a roster starts
// from. Split from the shift mutation service so each file stays
// reviewable.

const uuid = z.string().uuid();

export const shiftTemplateInput = z.object({
  locationId: uuid,
  name: z.string().trim().min(1).max(80),
  startTime: wallTime,
  endTime: wallTime,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export type ShiftTemplateRow = {
  id: string;
  locationId: string;
  name: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
};

type Fail = { ok: false; error: string };
export type TemplateResult = { ok: true; templateId: string } | Fail;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid roster input.";
}

export async function createShiftTemplate(
  ctx: ActionCtx,
  raw: unknown,
): Promise<TemplateResult> {
  const parsed = shiftTemplateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  if (normalizeWall(input.endTime) <= normalizeWall(input.startTime)) {
    return { ok: false, error: "The end time must be after the start time." };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, input.locationId)) {
      return { ok: false, error: "Location not found." };
    }

    const [inserted] = await tx
      .insert(shiftTemplates)
      .values({
        tenantId: ctx.tenantId,
        locationId: input.locationId,
        name: input.name,
        startTime: normalizeWall(input.startTime),
        endTime: normalizeWall(input.endTime),
        daysOfWeek: [...new Set(input.daysOfWeek)].sort((a, b) => a - b),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: shiftTemplates.id });
    if (!inserted) return { ok: false, error: "The template could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "shift_template.create",
      entityType: "shift_template",
      entityId: inserted.id,
      after: {
        locationId: input.locationId,
        name: input.name,
        startTime: normalizeWall(input.startTime),
        endTime: normalizeWall(input.endTime),
        daysOfWeek: input.daysOfWeek,
      },
    });

    return { ok: true, templateId: inserted.id };
  });
}

export async function listShiftTemplates(
  ctx: ActionCtx,
  filters: { locationId?: string } = {},
): Promise<ShiftTemplateRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [eq(shiftTemplates.tenantId, ctx.tenantId)];
    if (filters.locationId) {
      conditions.push(eq(shiftTemplates.locationId, filters.locationId));
    }
    const predicate = locationPredicate(shiftTemplates.locationId, access);
    if (predicate) conditions.push(predicate);

    return tx
      .select({
        id: shiftTemplates.id,
        locationId: shiftTemplates.locationId,
        name: shiftTemplates.name,
        startTime: shiftTemplates.startTime,
        endTime: shiftTemplates.endTime,
        daysOfWeek: shiftTemplates.daysOfWeek,
      })
      .from(shiftTemplates)
      .where(and(...conditions))
      .orderBy(asc(shiftTemplates.name));
  });
}
