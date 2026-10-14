import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { members, persons } from "@/db/schema/people";
import { NotFoundError, type ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import { locationVisible, resolveLocationAccess } from "./location-access";
import { resourceRole } from "./resource-access";
import { coachStaffIdSubquery } from "./staff";
import { writeAudit } from "@/lib/audit/write";

export async function markAttendance(ctx: ActionCtx, input: {
  sessionId: string; memberId: string; status: "present" | "absent" | "late"; clientId: string;
}): Promise<void> {
  // R01 — student attendance is execution work (coach / front-desk
  // backup). Owner/Admin contexts are refused even if an old or
  // accidentally assigned attendance.mark grant survives on their
  // role; read/status reporting is unaffected. Fail closed with the
  // same not-found shape the scope checks use.
  if (ctx.roleKey === "owner" || ctx.roleKey === "admin") {
    throw new NotFoundError();
  }
  await withTenant(ctx.tenantId, async tx => {
    // Serialize against cancellation/substitution and retain the session lock
    // through eligibility, write and audit. Never authorize by session alone.
    const [session] = await tx.select().from(sessions).where(and(
      eq(sessions.id, input.sessionId), eq(sessions.tenantId, ctx.tenantId))).for("update");
    if (!session || session.status === "cancelled" ||
      !locationVisible(await resolveLocationAccess(tx, ctx), session.locationId)) throw new NotFoundError();
    if (await resourceRole(tx, ctx) === "coach") {
      const [assigned] = await tx.select({ id: sessions.id }).from(sessions).where(and(
        eq(sessions.id, session.id), eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId))));
      if (!assigned) throw new NotFoundError();
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
      if (!priorMark) throw new NotFoundError();
    }
    const memberId = eligible?.id ?? asMemberId(input.memberId);
    const [previous] = await tx.select().from(attendance).where(and(eq(attendance.tenantId, ctx.tenantId),
      eq(attendance.sessionId, session.id), eq(attendance.memberId, memberId))).for("update");
    if (previous?.clientId === input.clientId) return;
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
