import { and, asc, between, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { shiftTemplates, shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { addDays, zonedWallTimeToInstant } from "@/lib/time/tz";
import { asStaffId, type StaffId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-23 — shift templates and the weekly roster (architecture.md §8.9).
//
// The publish gate lives here: `publishRosterWeek` stamps
// `published_at` on the week's shifts, and the only staff-facing read
// (`listMyPublishedShifts`) filters on it. A draft roster is invisible
// to the people on it until the owner publishes — deleting either half
// turns tests/tier1/shifts.test.ts red.
//
// Wall times on templates are materialised to timestamptz at the
// tenant's timezone inside the insert's transaction, so a shift's
// start/end never depends on the server's zone.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const wallTime = z
  .string()
  .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, "Use a HH:MM time.");

export const shiftTemplateInput = z.object({
  locationId: uuid,
  name: z.string().trim().min(1).max(80),
  startTime: wallTime,
  endTime: wallTime,
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

export const shiftInput = z.object({
  staffId: uuid,
  locationId: uuid,
  shiftDate: isoDate,
  startTime: wallTime,
  endTime: wallTime,
  templateId: uuid.nullish(),
});

export const rosterRangeInput = z.object({
  locationId: uuid.optional(),
  fromDate: isoDate,
  toDate: isoDate,
});

export const publishRosterInput = z.object({
  locationId: uuid.optional(),
  weekStart: isoDate,
});

export type ShiftTemplateRow = {
  id: string;
  locationId: string;
  name: string;
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
};

export type RosterShiftRow = {
  id: string;
  staffId: string;
  staffName: string;
  staffType: string;
  locationId: string;
  shiftDate: string;
  startAt: string;
  endAt: string;
  status: string;
  publishedAt: string | null;
};

export type MyShiftRow = {
  id: string;
  staffId: string;
  locationId: string;
  shiftDate: string;
  startAt: string;
  endAt: string;
  status: string;
};

type Ok = { ok: true };
type Fail = { ok: false; error: string };
export type ShiftResult = { ok: true; shiftId: string } | Fail;
export type TemplateResult = { ok: true; templateId: string } | Fail;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid roster input.";
}

// "6:00" and "06:00:00" both normalise to "06:00" so comparisons and
// inserts are stable regardless of what the form or a template row
// carried.
function normalizeWall(value: string): string {
  const [hours = "0", minutes = "0"] = value.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
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

export async function createShift(ctx: ActionCtx, raw: unknown): Promise<ShiftResult> {
  const parsed = shiftInput.safeParse(raw);
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

    const [member] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.id, asStaffId(input.staffId)),
          eq(staff.tenantId, ctx.tenantId),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);
    if (!member) return { ok: false, error: "Staff member not found." };

    const timezone = await tenantTimezoneInTx(tx, ctx.tenantId);
    const startAt = zonedWallTimeToInstant(
      input.shiftDate,
      normalizeWall(input.startTime),
      timezone,
    );
    const endAt = zonedWallTimeToInstant(
      input.shiftDate,
      normalizeWall(input.endTime),
      timezone,
    );

    let inserted: { id: string } | undefined;
    try {
      [inserted] = await tx
        .insert(shifts)
        .values({
          tenantId: ctx.tenantId,
          staffId: asStaffId(input.staffId),
          locationId: input.locationId,
          templateId: input.templateId ?? null,
          shiftDate: input.shiftDate,
          startAt,
          endAt,
          status: "rostered",
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning({ id: shifts.id });
    } catch (error) {
      const code = pgErrorCode(error);
      if (code === "23505") {
        return { ok: false, error: "That staff member already has a shift at this time." };
      }
      if (code === "23503" || code === "23514") {
        return { ok: false, error: "That shift could not be saved." };
      }
      throw error;
    }
    if (!inserted) return { ok: false, error: "The shift could not be saved." };

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "shift.create",
      entityType: "shift",
      entityId: inserted.id,
      after: {
        staffId: input.staffId,
        locationId: input.locationId,
        shiftDate: input.shiftDate,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        status: "rostered",
      },
    });

    return { ok: true, shiftId: inserted.id };
  });
}

export async function deleteShift(ctx: ActionCtx, shiftId: string): Promise<Ok | Fail> {
  const parsed = uuid.safeParse(shiftId);
  if (!parsed.success) return { ok: false, error: "Invalid shift." };
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const [row] = await tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, parsed.data), eq(shifts.tenantId, ctx.tenantId)))
      .for("update");
    if (!row || !locationVisible(access, row.locationId)) {
      return { ok: false, error: "Shift not found." };
    }

    await tx
      .delete(shifts)
      .where(and(eq(shifts.id, row.id), eq(shifts.tenantId, ctx.tenantId)));

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "shift.delete",
      entityType: "shift",
      entityId: row.id,
      before: {
        staffId: row.staffId,
        shiftDate: row.shiftDate,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        status: row.status,
      },
    });

    return { ok: true };
  });
}

export async function listRosterWeek(
  ctx: ActionCtx,
  raw: unknown,
): Promise<RosterShiftRow[]> {
  const parsed = rosterRangeInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(shifts.tenantId, ctx.tenantId),
      between(shifts.shiftDate, input.fromDate, input.toDate),
    ];
    if (input.locationId) conditions.push(eq(shifts.locationId, input.locationId));
    const predicate = locationPredicate(shifts.locationId, access);
    if (predicate) conditions.push(predicate);

    const rows = await tx
      .select({
        id: shifts.id,
        staffId: shifts.staffId,
        staffName: persons.fullName,
        staffType: staff.staffType,
        locationId: shifts.locationId,
        shiftDate: shifts.shiftDate,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        status: shifts.status,
        publishedAt: shifts.publishedAt,
      })
      .from(shifts)
      .innerJoin(staff, eq(staff.id, shifts.staffId))
      .innerJoin(persons, eq(persons.id, staff.personId))
      .where(and(...conditions))
      .orderBy(asc(shifts.shiftDate), asc(shifts.startAt), asc(persons.fullName));

    return rows.map((r) => ({
      ...r,
      staffId: r.staffId as StaffId,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
    }));
  });
}

export type PublishRosterResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export async function publishRosterWeek(
  ctx: ActionCtx,
  raw: unknown,
): Promise<PublishRosterResult> {
  const parsed = publishRosterInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  if (!ctx.userId) return { ok: false, error: "Not authenticated." };
  const weekEnd = addDays(input.weekStart, 6);

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(shifts.tenantId, ctx.tenantId),
      between(shifts.shiftDate, input.weekStart, weekEnd),
      isNull(shifts.publishedAt),
    ];
    if (input.locationId) conditions.push(eq(shifts.locationId, input.locationId));
    const predicate = locationPredicate(shifts.locationId, access);
    if (predicate) conditions.push(predicate);

    const published = await tx
      .update(shifts)
      .set({ publishedAt: new Date(), updatedBy: ctx.userId })
      .where(and(...conditions))
      .returning({ id: shifts.id });

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      requestId: ctx.requestId ?? null,
      action: "shift.publish",
      entityType: "roster",
      // entity_id is a uuid column; the week lives in `after`.
      entityId: input.locationId ?? null,
      after: {
        weekStart: input.weekStart,
        weekEnd,
        locationId: input.locationId ?? null,
        count: published.length,
      },
    });

    return { ok: true, count: published.length };
  });
}

// The staff-facing read: only published shifts, only the caller's own
// staff row. A user with no staff record (e.g. an owner account) gets
// an empty list, not an error — the page renders its honest empty
// state.
export async function listMyPublishedShifts(
  ctx: ActionCtx,
  raw: unknown,
): Promise<MyShiftRow[]> {
  if (!ctx.userId) return [];
  const parsed = rosterRangeInput.safeParse(raw);
  if (!parsed.success) return [];
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const [own] = await tx
      .select({ id: staff.id })
      .from(staff)
      .where(
        and(
          eq(staff.tenantId, ctx.tenantId),
          eq(staff.userId, ctx.userId!),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);
    if (!own) return [];

    const rows = await tx
      .select({
        id: shifts.id,
        staffId: shifts.staffId,
        locationId: shifts.locationId,
        shiftDate: shifts.shiftDate,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        status: shifts.status,
      })
      .from(shifts)
      .where(
        and(
          eq(shifts.tenantId, ctx.tenantId),
          eq(shifts.staffId, own.id),
          sql`${shifts.publishedAt} is not null`,
          between(shifts.shiftDate, input.fromDate, input.toDate),
        ),
      )
      .orderBy(asc(shifts.shiftDate), asc(shifts.startAt));

    return rows.map((r) => ({
      ...r,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
    }));
  });
}

// Drizzle wraps driver errors; the SQLSTATE lives on the cause chain.
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
