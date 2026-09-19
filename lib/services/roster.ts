import { and, asc, between, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { shifts } from "@/db/schema/shifts";
import { staff } from "@/db/schema/staff";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { addDays } from "@/lib/time/tz";
import type { StaffId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-23 — the roster reads and the publish gate. Split from the
// template/shift mutation service so each file stays reviewable; the
// publish gate's two halves live together here (stamp + the only
// staff-facing filter).

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const rosterRangeInput = z.object({
  locationId: uuid.optional(),
  fromDate: isoDate,
  toDate: isoDate,
});

export const publishRosterInput = z.object({
  locationId: uuid.optional(),
  weekStart: isoDate,
});

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

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid roster input.";
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
