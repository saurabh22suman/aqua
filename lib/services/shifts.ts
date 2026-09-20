import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { writeAudit } from "@/lib/audit/write";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { zonedWallTimeToInstant } from "@/lib/time/tz";
import { asStaffId } from "@/lib/ids";
import { normalizeWall, wallTime } from "@/lib/services/shift-time";
import type { ActionCtx } from "@/lib/auth/context";

// V-23 — shift mutations (architecture.md §8.9). Templates live in
// ./shift-templates, the roster reads and publish gate in ./roster;
// both are re-exported below so callers keep one import path.
//
// Wall times on a shift are materialised to timestamptz at the
// tenant's timezone inside the insert's transaction, so a shift's
// start/end never depends on the server's zone.

export * from "./roster";
export * from "./shift-templates";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const shiftInput = z.object({
  staffId: uuid,
  locationId: uuid,
  shiftDate: isoDate,
  startTime: wallTime,
  endTime: wallTime,
  templateId: uuid.nullish(),
});

type Ok = { ok: true };
type Fail = { ok: false; error: string };
export type ShiftResult = { ok: true; shiftId: string } | Fail;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid roster input.";
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
