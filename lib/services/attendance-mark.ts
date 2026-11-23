import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { members, persons } from "@/db/schema/people";
import { NotFoundError, type ActionCtx, type MutationActor } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { locationVisible, resolveLocationAccess } from "./location-access";
import { callerHasPermission, resourceRole } from "./resource-access";
import { coachStaffIdSubquery } from "./staff";
import { writeAudit } from "@/lib/audit/write";
import { auditLog } from "@/db/schema/audit";

export class AttendanceReviewRequired extends NotFoundError {
  override name = "AttendanceReviewRequired";
}

export async function liveAttendanceAuthority(ctx: ActionCtx): Promise<boolean> {
  return withTenant(ctx.tenantId, async tx => {
    const role = await resourceRole(tx, ctx);
    return Boolean(role && role !== "owner" && role !== "admin" && await callerHasPermission(tx, ctx, "attendance.mark"));
  });
}

export async function markAttendance(ctx: MutationActor, input: {
  sessionId: string; memberId: string; status: "present" | "absent" | "late"; clientId: string;
}): Promise<void> {
  await withTenant(ctx.tenantId, async tx => {
    // R01 is based on the live role, never a caller-supplied role claim.
    // A stale or removed grant cannot authorize the mark either.
    const role = await resourceRole(tx, ctx);
    if (!role || role === "owner" || role === "admin" || !(await callerHasPermission(tx, ctx, "attendance.mark"))) throw new NotFoundError();
    // Operation IDs are tenant-wide, including when competing requests target
    // different sessions. Acquire this before any session lock to avoid cycles.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`attendance-operation:${ctx.tenantId}:${input.clientId}`}, 0))`);
    // Serialize against cancellation/substitution and retain the session lock
    // through eligibility, write and audit. Never authorize by session alone.
    const [session] = await tx.select().from(sessions).where(and(
      eq(sessions.id, input.sessionId), eq(sessions.tenantId, ctx.tenantId))).for("update");
    if (!session || session.status === "cancelled" ||
      !locationVisible(await resolveLocationAccess(tx, ctx), session.locationId)) throw new AttendanceReviewRequired();
    if (role === "coach") {
      const [assigned] = await tx.select({ id: sessions.id }).from(sessions).where(and(
        eq(sessions.id, session.id), eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId))));
      if (!assigned) throw new AttendanceReviewRequired();
    }
    const [eligible] = await tx.select({ id: members.id }).from(enrolments)
      .innerJoin(members, and(eq(members.id, enrolments.memberId), eq(members.tenantId, ctx.tenantId)))
      .innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, ctx.tenantId)))
      .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, session.batchId),
        eq(members.id, asMemberId(input.memberId)), lte(enrolments.enrolledOn, session.sessionDate),
        inArray(members.status, ["active", "trial"]), isNull(members.deletedAt), isNull(persons.deletedAt))).limit(1);
    if (!eligible) {
      // #195 — a historical correction of an already-marked session
      // survives a later batch transfer: the roster rule governs new
      // marks, not the correction of an existing one. The location and
      // coach checks above still apply.
      const [priorMark] = await tx.select({ id: attendance.id }).from(attendance)
        .where(and(eq(attendance.tenantId, ctx.tenantId), eq(attendance.sessionId, session.id),
          eq(attendance.memberId, asMemberId(input.memberId)))).limit(1);
      if (!priorMark) throw new AttendanceReviewRequired();
    }
    const memberId = eligible?.id ?? asMemberId(input.memberId);
    const [previous] = await tx.select().from(attendance).where(and(eq(attendance.tenantId, ctx.tenantId),
      eq(attendance.sessionId, session.id), eq(attendance.memberId, memberId))).for("update");
    // Immutable audit rows are written atomically with each mark. Query all
    // history, not merely the current attendance row; reject conflicting reuse.
    const operations = await tx.select({ payload: auditLog.after }).from(auditLog).where(and(
      eq(auditLog.tenantId, ctx.tenantId), sql`${auditLog.action} = 'attendance.mark'`,
      sql`${auditLog.entityType} = 'attendance'`, sql`${auditLog.after}->>'clientId' = ${input.clientId}`));
    if (operations.length) {
      if (operations.some(({ payload }) => {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
        const record = payload as Record<string, unknown>;
        return record.sessionId !== session.id || record.memberId !== memberId || record.status !== input.status;
      })) throw new AttendanceReviewRequired();
      return;
    }
    // Older marks may lack an operation audit, but a current ID must never be
    // accepted as a retry with a different status.
    if (previous?.clientId === input.clientId) {
      if (previous.status !== input.status) throw new AttendanceReviewRequired();
      return;
    }
    const [saved] = await tx.insert(attendance).values({ tenantId: ctx.tenantId, sessionId: session.id,
      locationId: session.locationId, memberId, status: input.status, clientId: input.clientId,
      markedBy: ctx.userId, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).onConflictDoUpdate({ target: [attendance.tenantId, attendance.sessionId, attendance.memberId], set: {
      status: input.status, clientId: input.clientId, locationId: session.locationId,
      markedAt: new Date(), markedBy: ctx.userId, updatedBy: ctx.userId, updatedAt: new Date(),
    } }).returning({ id: attendance.id });
    await writeAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.userId ? "user" : "system",
      requestId: ctx.requestId, action: "attendance.mark", entityType: "attendance", entityId: saved.id,
      before: previous ? { status: previous.status } : null,
      after: { status: input.status, memberId: input.memberId, sessionId: session.id, clientId: input.clientId } });
  });
}
