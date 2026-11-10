import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { staffAttendance } from "@/db/schema/staff-attendance";
import { staff } from "@/db/schema/staff";
import { staffLocations } from "@/db/schema/staff-locations";
import { shifts } from "@/db/schema/shifts";
import { hasOwnerCorrectionAuthority, makeOwnerResolution, readAttendanceSnapshot } from "@/lib/services/staff-attendance-owner-resolution";
import {
  membershipLocations,
  tenantMemberships,
} from "@/db/schema/memberships";
import { writeAudit } from "@/lib/audit/write";
import { ownStaffIdInTx } from "@/lib/services/staff-self";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import {
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import {
  callerHasPermission,
  callerIsLegacySystem,
} from "@/lib/services/resource-access";
import { todayInZone } from "@/lib/time/tz";
import { asStaffId, type StaffId, type TenantId, type UserId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// V-24 — the audited manual correction. Split from the check-in/out
// service because this is the path that must answer "who corrected
// this and why": the reason is required, `marked_by` is the correcting
// staff member, and the audit row carries before/after.

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");

export const correctionInput = z.object({
  staffId: uuid,
  workDate: isoDate,
  status: z.enum(["present", "absent", "half_day", "leave", "holiday"]),
  note: z.string().trim().min(1, "A correction needs a reason.").max(500),
  checkedInAt: z.string().datetime({ offset: true }).nullish(),
  checkedOutAt: z.string().datetime({ offset: true }).nullish(),
  lateMinutes: z.number().int().min(0).max(1440).optional(),
});

export type AttendanceResult =
  | { ok: true; attendanceId: string }
  | { ok: false; error: string };

// Legacy O-08 scoped staff: "where does this staff member work?" This is
// the established assignment/membership answer, used ONLY for the legacy
// branch. It is not evidence of where a particular staff/date row
// occurred, so it must never authorise a facility-scoped manager.
async function targetLocationAccessInTx(
  tx: TenantTx,
  tenantId: TenantId,
  target: { id: StaffId; userId: UserId | null },
): Promise<{ allLocations: boolean; locationIds: string[] }> {
  const rows = await tx
    .select({ locationId: staffLocations.locationId })
    .from(staffLocations)
    .where(
      and(
        eq(staffLocations.tenantId, tenantId),
        eq(staffLocations.staffId, target.id),
      ),
    );
  const locationIds = new Set(rows.map((row) => row.locationId));

  if (!target.userId) return { allLocations: false, locationIds: [...locationIds] };

  const memberships = await tx
    .select({ id: tenantMemberships.id, allLocations: tenantMemberships.allLocations })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, target.userId),
        eq(tenantMemberships.status, "active"),
        isNull(tenantMemberships.deletedAt),
      ),
    );
  if (memberships.some((membership) => membership.allLocations)) {
    return { allLocations: true, locationIds: [...locationIds] };
  }
  if (memberships.length > 0) {
    const membershipRows = await tx
      .select({ locationId: membershipLocations.locationId })
      .from(membershipLocations)
      .where(
        and(
          eq(membershipLocations.tenantId, tenantId),
          inArray(
            membershipLocations.membershipId,
            memberships.map((membership) => membership.id),
          ),
        ),
      );
    for (const row of membershipRows) locationIds.add(row.locationId);
  }
  return { allLocations: false, locationIds: [...locationIds] };
}

// The facility a SPECIFIC attendance row records.
//
// `staff_attendance` has no location column and is keyed by staff/work
// date. The employee's assignments are therefore not evidence of where
// this row happened: a person assigned to A and C has one row per day,
// and only the row's own link can say which facility it belongs to.
// The optional `shift_id` is that link. It is usable only when:
//
//   • the shift exists in this tenant;
//   • it belongs to the SAME staff member — the FK is composite on
//     (shift_id, tenant_id), not on staff, so this must be checked;
//   • it is on the SAME work date — check-in accepts a client-supplied
//     shift id without re-checking the date;
//   • it has a location (NOT NULL by schema).
//
// Anything else is missing/unlocated/foreign evidence. Return null and
// let the caller hold the correction; never fall back to the target's
// staff_locations or membership assignment.
async function recordedAttendanceLocationInTx(
  tx: TenantTx,
  tenantId: TenantId,
  attendance: { shiftId: string | null; staffId: StaffId; workDate: string },
): Promise<string | null> {
  if (!attendance.shiftId) return null;

  const [shift] = await tx
    .select({
      staffId: shifts.staffId,
      shiftDate: shifts.shiftDate,
      locationId: shifts.locationId,
    })
    .from(shifts)
    .where(and(eq(shifts.id, attendance.shiftId), eq(shifts.tenantId, tenantId)))
    .limit(1);

  if (!shift) return null;
  if (shift.staffId !== attendance.staffId) return null;
  if (shift.shiftDate !== attendance.workDate) return null;
  return shift.locationId;
}

export async function correctAttendance(
  ctx: ActionCtx,
  raw: unknown,
): Promise<AttendanceResult> {
  const parsed = correctionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid attendance input.",
    };
  }
  const input = parsed.data;

  return withTenant(ctx.tenantId, async (tx) => {
    if (ctx.userId && !uuid.safeParse(ctx.userId).success) {
      return { ok: false, error: "Your login is not linked to a staff record." };
    }
    const marker = await ownStaffIdInTx(tx, ctx);
    // Resolve authority before target and attendance locks; non-owners may
    // still correct under the existing path but never attest owner resolution.
    const ownerAuthority = (!marker || input.status === "leave") && await hasOwnerCorrectionAuthority(tx, ctx);
    let ownerMarker: UserId | null = null;
    if (!marker) {
      if (!ownerAuthority || !ctx.userId) {
        return { ok: false, error: "Your login is not linked to a staff record." };
      }
      ownerMarker = ctx.userId;
    }

    const [target] = await tx
      .select({ id: staff.id, userId: staff.userId })
      .from(staff)
      .where(
        and(
          eq(staff.id, asStaffId(input.staffId)),
          eq(staff.tenantId, ctx.tenantId),
          isNull(staff.deletedAt),
        ),
      )
      .limit(1);
    if (!target) return { ok: false, error: "Staff member not found." };

    const access = await resolveLocationAccess(tx, ctx);
    if (!access.unrestricted && access.denied) {
      return { ok: false, error: "You cannot record attendance." };
    }

    // Locate the candidate shift without trusting the preliminary read, then
    // lock shift before attendance, matching the leave-decision lock order.
    let lockedOwnerShift: string | null = null;
    let observedOwnerRecord: { id: string; shiftId: string | null } | null = null;
    if (ownerAuthority && input.status === "leave") {
      const [candidate] = await tx.select({ id: staffAttendance.id, shiftId: staffAttendance.shiftId }).from(staffAttendance)
        .where(and(eq(staffAttendance.tenantId, ctx.tenantId), eq(staffAttendance.staffId, target.id),
          eq(staffAttendance.workDate, input.workDate))).limit(1);
      observedOwnerRecord = candidate ?? null;
      if (candidate?.shiftId) {
        const [shift] = await tx.select({ id: shifts.id }).from(shifts)
          .where(and(eq(shifts.tenantId, ctx.tenantId), eq(shifts.id, candidate.shiftId),
            eq(shifts.staffId, target.id), eq(shifts.shiftDate, input.workDate))).limit(1).for("update");
        lockedOwnerShift = shift?.id ?? null;
      }
    }

    // The row is loaded after the denial answer but before the scoped
    // decision: a facility-scoped manager's answer depends on THIS
    // record, not on the employee's assignment. It is also the row the
    // mutation path locks, so the check and the write see the same row.
    const [existing] = await tx
      .select()
      .from(staffAttendance)
      .where(
        and(
          eq(staffAttendance.tenantId, ctx.tenantId),
          eq(staffAttendance.staffId, target.id),
          eq(staffAttendance.workDate, input.workDate),
        ),
      )
      .for("update");

    if (ownerAuthority && input.status === "leave" &&
        ((observedOwnerRecord?.id ?? null) !== (existing?.id ?? null) ||
         (observedOwnerRecord?.shiftId ?? null) !== (existing?.shiftId ?? null))) {
      return { ok: false, error: "The attendance record changed. Please try again." };
    }

    // This exception cannot create an unrecorded day; existing corrections
    // remain correctable, including a prior correction to leave.
    if (ownerMarker && !existing) {
      return { ok: false, error: "You cannot correct attendance for this staff member on this day." };
    }

    if (!access.unrestricted) {
      if (access.includeUnlocated) {
        // Legacy O-08 scoped staff keep the established house rule: an
        // all-locations TARGET is whole-business and stays reachable.
        // This branch is deliberately separate from the facility-scoped
        // manager below and is not evidence for it.
        const targetAccess = await targetLocationAccessInTx(tx, ctx.tenantId, target);
        const allowed =
          targetAccess.allLocations ||
          (access.locationIds.length > 0 &&
            targetAccess.locationIds.some((locationId) =>
              access.locationIds.includes(locationId),
            ));
        if (!allowed) {
          return {
            ok: false,
            error: "That staff member is not at one of your locations.",
          };
        }
      } else {
        // Facility-scoped manager: the RECORD must prove its facility.
        // A new row has no shift and no location — assignment is not
        // proof — so it is held, never inferred or manufactured.
        if (!existing) {
          return { ok: false, error: "You cannot correct attendance for this staff member on this day." };
        }

        const recordedLocationId = await recordedAttendanceLocationInTx(
          tx,
          ctx.tenantId,
          existing,
        );
        if (!recordedLocationId) {
          return { ok: false, error: "You cannot correct attendance for this staff member on this day." };
        }
        if (!locationVisible(access, recordedLocationId)) {
          return { ok: false, error: "You cannot correct attendance for this staff member on this day." };
        }
      }
    }

    const timezone = await tenantTimezoneInTx(tx, ctx.tenantId);
    if (input.workDate !== todayInZone(timezone)) {
      const management =
        callerIsLegacySystem(ctx) ||
        (await callerHasPermission(tx, ctx, "settings.manage"));
      if (!management) {
        return {
          ok: false,
          error:
            "Only an owner or admin can change another day's attendance. Ask them to make this correction.",
        };
      }
    }

    const checkedInAt = input.checkedInAt ? new Date(input.checkedInAt) : null;
    const checkedOutAt = input.checkedOutAt ? new Date(input.checkedOutAt) : null;
    if (checkedOutAt && !checkedInAt) {
      return {
        ok: false,
        error: "A check-out needs a check-in time on the same correction.",
      };
    }

    const values = {
      method: "manual" as const,
      markedBy: marker,
      markedByUserId: ownerMarker,
      status: input.status,
      note: input.note,
      checkedInAt: checkedInAt ?? existing?.checkedInAt ?? null,
      checkedOutAt: checkedOutAt ?? existing?.checkedOutAt ?? null,
      lateMinutes: input.lateMinutes ?? existing?.lateMinutes ?? 0,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };

    if (!values.checkedInAt && values.checkedOutAt) {
      return {
        ok: false,
        error: "A check-out needs a check-in time on the same correction.",
      };
    }

    let attendanceId: string;
    if (existing) {
      const [updated] = await tx
        .update(staffAttendance)
        .set(values)
        .where(
          and(
            eq(staffAttendance.id, existing.id),
            eq(staffAttendance.tenantId, ctx.tenantId),
          ),
        )
        .returning({ id: staffAttendance.id });
      if (!updated) return { ok: false, error: "The correction could not be saved." };
      attendanceId = updated.id;
      // Bind proof to the full current record and the shift locked first;
      // approval checks both again under its own shift/attendance locks.
      const currentSnapshot = ownerAuthority && input.status === "leave" && existing.shiftId && existing.shiftId === lockedOwnerShift && ctx.userId
        ? await readAttendanceSnapshot(tx, ctx.tenantId, attendanceId) : null;
      if (ownerAuthority && input.status === "leave" && existing.shiftId && existing.shiftId === lockedOwnerShift && !currentSnapshot) {
        throw new Error("Owner resolution could not be recorded.");
      }
      const ownerResolution = currentSnapshot && ctx.userId ? makeOwnerResolution(currentSnapshot, ctx.userId) : undefined;

      // The prior/new clock times belong in the trail whenever the
      // correction moves them: without them a wrong check-in time
      // correction has no before/after evidence.
      const timeFieldsChanged =
        (existing.checkedInAt?.getTime() ?? null) !==
          (values.checkedInAt?.getTime() ?? null) ||
        (existing.checkedOutAt?.getTime() ?? null) !==
          (values.checkedOutAt?.getTime() ?? null);

      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId ?? null,
        action: "staff.attendance.correct",
        entityType: "staff_attendance",
        entityId: attendanceId,
        before: {
          status: existing.status,
          method: existing.method,
          markedBy: existing.markedBy,
          markedByUserId: existing.markedByUserId,
          note: existing.note,
          lateMinutes: existing.lateMinutes,
          ...(timeFieldsChanged
            ? {
                checkedInAt: existing.checkedInAt?.toISOString() ?? null,
                checkedOutAt: existing.checkedOutAt?.toISOString() ?? null,
              }
            : {}),
        },
        after: {
          staffId: input.staffId,
          workDate: input.workDate,
          status: input.status,
          method: "manual",
          note: input.note,
          lateMinutes: values.lateMinutes,
          markedBy: marker,
          markedByUserId: ownerMarker,
          ...(ownerResolution ? { ownerResolution } : {}),
          ...(timeFieldsChanged
            ? {
                checkedInAt: values.checkedInAt?.toISOString() ?? null,
                checkedOutAt: values.checkedOutAt?.toISOString() ?? null,
              }
            : {}),
        },
      });
    } else {
      const [inserted] = await tx
        .insert(staffAttendance)
        .values({
          tenantId: ctx.tenantId,
          staffId: target.id,
          workDate: input.workDate,
          ...values,
          clientId: `manual:${target.id}:${input.workDate}`,
          createdBy: ctx.userId,
        })
        .returning({ id: staffAttendance.id });
      if (!inserted) return { ok: false, error: "The correction could not be saved." };
      attendanceId = inserted.id;

      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        requestId: ctx.requestId ?? null,
        action: "staff.attendance.correct",
        entityType: "staff_attendance",
        entityId: attendanceId,
        after: {
          staffId: input.staffId,
          workDate: input.workDate,
          status: input.status,
          method: "manual",
          note: input.note,
          lateMinutes: values.lateMinutes,
          checkedInAt: values.checkedInAt?.toISOString() ?? null,
          checkedOutAt: values.checkedOutAt?.toISOString() ?? null,
          markedBy: marker,
          markedByUserId: ownerMarker,
        },
      });
    }

    return { ok: true, attendanceId };
  });
}
