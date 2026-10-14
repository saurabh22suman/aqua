import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { batches } from "@/db/schema/programs";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import type { ActionCtx } from "@/lib/auth/context";
import { coachStaffIdSubquery } from "./staff";
import { locationPredicate, locationVisible, resolveLocationAccess, type LocationAwareCtx } from "./location-access";
import { createMember as registerMember } from "./member-registration";
import { markAttendance as writeAttendance } from "./attendance-mark";
import { visibleMember, isCoachLikeRoleKey } from "./resource-access";
import { asMemberId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { writeAudit } from "@/lib/audit/write";

// Stable façade for action/job callers; mutation responsibilities are separate
// modules so their eligibility, transaction and audit contracts stay reviewable.
export { createMemberInTx, type GuardianInput } from "./member-registration";

export async function createMember(ctx: ActionCtx, input: Parameters<typeof registerMember>[1]): ReturnType<typeof registerMember> {
  if (!input.memberCode.trim()) return { ok: false, error: "A member code is required." };
  if (!input.consents.some(consent => consent.purpose === "processing")) {
    return { ok: false, error: "Processing consent is required to register a member." };
  }
  return registerMember(ctx, input);
}

export async function markAttendance(ctx: LocationAwareCtx, input: Parameters<typeof writeAttendance>[1]): Promise<void> {
  if (!input.clientId.trim()) throw new Error("Attendance needs an idempotency key.");
  return writeAttendance(ctx, input);
}

export async function enrolMember(ctx: LocationAwareCtx, input: { memberId: string; batchId: string; enrolledOn?: string }):
Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async tx => {
    const [batch] = await tx.select({ capacity: batches.capacity, locationId: batches.locationId }).from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt))).for("update");
    if (!batch || !locationVisible(await resolveLocationAccess(tx, ctx), batch.locationId)) return { ok: false, error: "Batch not found." };
    if (!await visibleMember(tx, ctx, input.memberId)) return { ok: false, error: "Member not found." };
    const [existing] = await tx.select({ id: enrolments.id }).from(enrolments).where(and(
      eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, input.batchId), eq(enrolments.memberId, asMemberId(input.memberId)))).limit(1);
    if (!existing) {
      const [{ n }] = await tx.select({ n: sql<number>`count(distinct ${enrolments.memberId})::int` }).from(enrolments)
        .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, input.batchId)));
      if (n >= batch.capacity) return { ok: false, error: `This batch is full (capacity ${batch.capacity}).` };
    }
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const enrolledOn = input.enrolledOn ?? todayInZone(tenant.timezone);
    const [inserted] = await tx.insert(enrolments).values({ tenantId: ctx.tenantId, memberId: asMemberId(input.memberId),
      batchId: input.batchId, enrolledOn, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).onConflictDoNothing().returning({ id: enrolments.id });
    if (inserted) await writeAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId,
      actorType: ctx.userId ? "user" : "system", requestId: ctx.requestId, action: "member.enrol",
      entityType: "enrolment", entityId: inserted.id, after: { memberId: input.memberId, batchId: input.batchId, enrolledOn } });
    return { ok: true };
  });
}

export async function countAttendanceForSession(ctx: ActionCtx, sessionId: string): Promise<number> {
  return withTenant(ctx.tenantId, async tx => {
    const access = await resolveLocationAccess(tx, ctx);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId)).where(and(
        eq(attendance.tenantId, ctx.tenantId), eq(attendance.sessionId, sessionId),
        locationPredicate(sessions.locationId, access)));
    return n;
  });
}

export type TodaySessionRow = { id: string; batchName: string; startsAt: Date; endsAt: Date; marked: number; total: number };

export async function listTodaySessions(ctx: ActionCtx & { roleKey: string }, today: string): Promise<TodaySessionRow[]> {
  return withTenant(ctx.tenantId, async tx => tx.select({
    id: sessions.id, batchName: batches.name, startsAt: sessions.startsAt, endsAt: sessions.endsAt,
    marked: sql<number>`(select count(*)::int from ${attendance} a where a.session_id = ${sessions.id})`,
    total: sql<number>`(select count(distinct e.member_id)::int from ${enrolments} e join ${members} m on m.id=e.member_id
      where e.batch_id=${sessions.batchId} and e.enrolled_on<=${today} and e.tenant_id=${ctx.tenantId}
      and m.status in ('active','trial') and m.deleted_at is null)`,
  }).from(sessions).innerJoin(batches, eq(batches.id, sessions.batchId)).where(and(
    eq(sessions.tenantId, ctx.tenantId), eq(sessions.sessionDate, today),
    isCoachLikeRoleKey(ctx.roleKey) ? eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)) : undefined,
    locationPredicate(sessions.locationId, await resolveLocationAccess(tx, ctx)),
  )).orderBy(sessions.startsAt));
}

async function visibleSession(tx: TenantTx, ctx: ActionCtx & { roleKey: string }, sessionId: string) {
  const [session] = await tx.select({ id: sessions.id, batchId: sessions.batchId, batchName: batches.name,
    startsAt: sessions.startsAt, sessionDate: sessions.sessionDate }).from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batchId)).where(and(
      eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId), isNull(batches.deletedAt),
      isCoachLikeRoleKey(ctx.roleKey) ? eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)) : undefined,
      locationPredicate(sessions.locationId, await resolveLocationAccess(tx, ctx)),
    )).limit(1);
  return session;
}

export async function sessionVisibleToCaller(ctx: ActionCtx & { roleKey: string }, sessionId: string): Promise<boolean> {
  return withTenant(ctx.tenantId, async tx => Boolean(await visibleSession(tx, ctx, sessionId)));
}

export type RosterRow = {
  memberId: string; name: string; code: string; status: "present" | "absent" | "late" | null;
  markedAt?: string | null; pct: number | null; isTrial: boolean;
};
export type RosterData = { batchName: string; startsAt: Date; offlineSyncEnabled: boolean; rows: RosterRow[] };

export async function getRosterForSession(ctx: ActionCtx & { roleKey: string }, sessionId: string): Promise<RosterData | null> {
  return withTenant(ctx.tenantId, async tx => {
    const session = await visibleSession(tx, ctx, sessionId);
    if (!session) return null;
    const [tenant] = await tx.select({ offlineSyncEnabled: tenants.offlineSyncEnabled }).from(tenants).where(eq(tenants.id, ctx.tenantId));
    const roster = await tx.select({ memberId: members.id, name: persons.fullName, code: members.memberCode,
      memberStatus: members.status, status: attendance.status, markedAt: attendance.markedAt,
      presentCount: sql<number>`(select count(*)::int from ${attendance} a where a.tenant_id=${ctx.tenantId}
        and a.member_id=${members.id} and a.status in ('present','late') and a.marked_at>=date_trunc('month',now()))`,
      totalCount: sql<number>`(select count(*)::int from ${attendance} a where a.tenant_id=${ctx.tenantId}
        and a.member_id=${members.id} and a.marked_at>=date_trunc('month',now()))`,
    }).from(enrolments).innerJoin(members, eq(members.id, enrolments.memberId)).innerJoin(persons, eq(persons.id, members.personId))
      .leftJoin(attendance, and(eq(attendance.memberId, members.id), eq(attendance.sessionId, sessionId)))
      .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, session.batchId),
        lte(enrolments.enrolledOn, session.sessionDate), inArray(members.status, ["active", "trial"]),
        isNull(members.deletedAt), isNull(persons.deletedAt))).orderBy(members.memberCode);
    const rows: RosterRow[] = [];
    const seen = new Set<string>();
    for (const row of roster) {
      if (seen.has(row.memberId)) continue;
      seen.add(row.memberId);
      rows.push({ memberId: row.memberId, name: row.name, code: row.code,
        status: row.status as RosterRow["status"], markedAt: row.markedAt?.toISOString() ?? null,
        pct: row.totalCount ? Math.round(row.presentCount / row.totalCount * 100) : null, isTrial: row.memberStatus === "trial" });
    }
    return { batchName: session.batchName, startsAt: session.startsAt, offlineSyncEnabled: tenant.offlineSyncEnabled, rows };
  });
}
