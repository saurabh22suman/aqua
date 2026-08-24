import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema";
import { attendance, sessions } from "@/db/schema/scheduling";
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
        target: [attendance.tenantId, attendance.clientId],
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
