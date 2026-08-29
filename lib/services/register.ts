import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema";
import { batches } from "@/db/schema/programs";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import type { Ctx } from "@/lib/auth/context";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

export async function createMember(
  ctx: ActionCtx,
  input: {
    fullName: string;
    dateOfBirth?: string;
    gender?: string;
    locationId: string;
    memberCode: string;
    medicalNotes?: string;
  },
): Promise<{ memberId: string; personId: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({
        tenantId: ctx.tenantId,
        fullName: input.fullName,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        medicalNotes: input.medicalNotes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: persons.id });

    const [member] = await tx
      .insert(members)
      .values({
        tenantId: ctx.tenantId,
        personId: person.id,
        locationId: input.locationId,
        memberCode: input.memberCode,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: members.id });

    return { memberId: member.id, personId: person.id };
  });
}

export async function enrolMember(
  ctx: ActionCtx,
  input: { memberId: string; batchId: string; enrolledOn?: string },
): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    const enrolledOn = input.enrolledOn ?? new Date().toISOString().slice(0, 10);
    await tx.execute(sql`
      insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
      values (${uuidv7()}, ${ctx.tenantId}, ${input.memberId}, ${input.batchId}, ${enrolledOn}::date)
      on conflict (tenant_id, member_id, batch_id, enrolled_on) do nothing
    `);
  });
}

export async function markAttendance(
  ctx: ActionCtx,
  input: { sessionId: string; memberId: string; status: "present" | "absent" | "late"; clientId: string },
): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    await tx
      .insert(attendance)
      .values({
        tenantId: ctx.tenantId,
        sessionId: input.sessionId,
        memberId: input.memberId,
        status: input.status,
        clientId: input.clientId,
      })
      .onConflictDoUpdate({
        target: [attendance.tenantId, attendance.sessionId, attendance.memberId],
        set: { status: input.status, markedAt: new Date() },
      });
  });
}

export async function countAttendanceForSession(
  ctx: ActionCtx,
  sessionId: string,
): Promise<number> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(and(eq(attendance.tenantId, ctx.tenantId), eq(attendance.sessionId, sessionId)));
    return rows[0].n;
  });
}

export type TodaySessionRow = {
  id: string;
  batchName: string;
  startsAt: Date;
  endsAt: Date;
  marked: number;
  total: number;
};

// getTodayAction (lib/actions/coach.ts) showed every session in the
// tenant to any staff member -- a coach could see (and, via
// getRosterAction, mark) another coach's register. A coach only ever
// sees sessions from batches assigned to them; every other staff role
// (owner, admin, receptionist, accountant) keeps full tenant-wide
// visibility -- their job requires oversight across all coaches, a
// coach's does not.
export async function listTodaySessions(
  ctx: ActionCtx & { roleKey: string },
  today: string,
): Promise<TodaySessionRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.tenantId, ctx.tenantId), eq(sessions.sessionDate, today)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, ctx.userId ?? ""));
    }

    const rows = await tx
      .select({
        id: sessions.id,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        marked: sql<number>`(select count(*)::int from ${attendance} a where a.session_id = ${sessions.id})`,
        total: sql<number>`(select count(*)::int from ${enrolments} e where e.batch_id = ${sessions.batchId} and e.enrolled_on <= ${today} and e.tenant_id = ${ctx.tenantId})`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(...conditions))
      .orderBy(sessions.startsAt);

    return rows;
  });
}

export async function sessionExistsInTenant(
  ctx: ActionCtx,
  sessionId: string,
): Promise<boolean> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)))
      .limit(1);
    return rows.length > 0;
  });
}
