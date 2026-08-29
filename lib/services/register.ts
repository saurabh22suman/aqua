import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema";
import { tenants } from "@/db/schema/tenants";
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

// C-18's own done-when: "enrolling beyond capacity is refused with a
// clear message." Previously a raw insert with no check at all -- a
// full batch would silently oversell. Capacity limits distinct
// members in the batch, not enrolment rows: a member already enrolled
// (re-enrolling on a new date, matching the existing upsert-by-day
// semantics below) never counts against capacity a second time.
export async function enrolMember(
  ctx: ActionCtx,
  input: { memberId: string; batchId: string; enrolledOn?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [batch] = await tx
      .select({ capacity: batches.capacity })
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.tenantId, ctx.tenantId)));
    if (!batch) return { ok: false, error: "Batch not found." };

    const alreadyEnrolled = await tx
      .select({ memberId: enrolments.memberId })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.batchId, input.batchId),
          eq(enrolments.memberId, input.memberId),
        ),
      )
      .limit(1);

    if (alreadyEnrolled.length === 0) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(distinct ${enrolments.memberId})::int` })
        .from(enrolments)
        .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, input.batchId)));
      if (n >= batch.capacity) {
        return { ok: false, error: `This batch is full (capacity ${batch.capacity}).` };
      }
    }

    const enrolledOn = input.enrolledOn ?? new Date().toISOString().slice(0, 10);
    await tx.execute(sql`
      insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
      values (${uuidv7()}, ${ctx.tenantId}, ${input.memberId}, ${input.batchId}, ${enrolledOn}::date)
      on conflict (tenant_id, member_id, batch_id, enrolled_on) do nothing
    `);
    return { ok: true };
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

// Renamed from sessionExistsInTenant: that name was the bug. Tenant
// membership is not the same question as "may this caller see this
// row" -- a coach is a tenant member for every session in the tenant,
// including every other coach's. Same coach-scoping condition as
// listTodaySessions and getRosterForSession, so all three answer
// "which sessions can THIS caller act on" identically rather than
// three independent, driftable checks.
export async function sessionVisibleToCaller(
  ctx: ActionCtx & { roleKey: string },
  sessionId: string,
): Promise<boolean> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, ctx.userId ?? ""));
    }
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  });
}

export type RosterRow = {
  memberId: string;
  name: string;
  code: string;
  status: "present" | "absent" | "late" | null;
  pct: number | null;
};

export type RosterData = {
  batchName: string;
  startsAt: Date;
  offlineSyncEnabled: boolean;
  rows: RosterRow[];
};

// getRosterAction (lib/actions/coach.ts) took a session id and only
// checked tenant membership before this fix -- a coach who knew or
// guessed another coach's session id could open (and, through
// markAttendanceSessionAction, mark) that register. Returns null for
// "not visible to this caller" with the SAME shape as "does not
// exist" -- the caller must not be able to tell those two apart,
// which is what makes this a 404, not a 403.
export async function getRosterForSession(
  ctx: ActionCtx & { roleKey: string },
  sessionId: string,
): Promise<RosterData | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, ctx.userId ?? ""));
    }

    const [session] = await tx
      .select({
        id: sessions.id,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        batchId: batches.id,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(...conditions));
    if (!session) return null;

    const [tenant] = await tx
      .select({ offlineSyncEnabled: tenants.offlineSyncEnabled })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const roster = await tx
      .select({
        memberId: members.id,
        name: persons.fullName,
        code: members.memberCode,
        status: attendance.status,
        presentCount: sql<number>`(
          select count(*)::int from ${attendance} a
          where a.tenant_id = ${ctx.tenantId}
            and a.member_id = ${members.id}
            and a.status in ('present', 'late')
            and a.marked_at >= date_trunc('month', now())
        )`,
        totalCount: sql<number>`(
          select count(*)::int from ${attendance} a
          where a.tenant_id = ${ctx.tenantId}
            and a.member_id = ${members.id}
            and a.marked_at >= date_trunc('month', now())
        )`,
      })
      .from(enrolments)
      .innerJoin(members, eq(members.id, enrolments.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .leftJoin(
        attendance,
        and(eq(attendance.memberId, members.id), eq(attendance.sessionId, sessionId)),
      )
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.batchId, session.batchId),
        ),
      )
      .orderBy(members.memberCode);

    const seen = new Set<string>();
    const rows: RosterRow[] = [];
    for (const r of roster) {
      if (seen.has(r.memberId)) continue;
      seen.add(r.memberId);
      rows.push({
        memberId: r.memberId,
        name: r.name,
        code: r.code,
        status: (r.status as RosterRow["status"]) ?? null,
        pct:
          r.totalCount > 0 ? Math.round((r.presentCount / r.totalCount) * 100) : null,
      });
    }

    return {
      batchName: session.batchName,
      startsAt: session.startsAt,
      offlineSyncEnabled: tenant.offlineSyncEnabled,
      rows,
    };
  });
}
