"use server";

import { and, eq, sql } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { withTenant } from "@/db/tenant";
import {
  attendance,
  batches,
  enrolments,
  members,
  persons,
  sessions,
  tenants,
} from "@/db/schema";
import { todayInZone } from "@/lib/time/tz";
import { listTodaySessions, markAttendance, sessionExistsInTenant } from "@/lib/services/register";
import { markAttendanceSchema, sessionIdSchema } from "@/lib/schemas";

export type TodaySession = {
  id: string;
  batchName: string;
  startsAt: string;
  endsAt: string;
  marked: number;
  total: number;
};

export async function getTodayAction(): Promise<{
  sessions: TodaySession[];
}> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);

  const [tenant] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
  );
  const today = todayInZone(tenant.timezone);

  const rows = await listTodaySessions(
    { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
    today,
  );

  return {
    sessions: rows.map((r) => ({
      id: r.id,
      batchName: r.batchName,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      marked: r.marked,
      total: r.total,
    })),
  };
}

export type RosterRow = {
  memberId: string;
  name: string;
  code: string;
  status: "present" | "absent" | "late" | null;
  pct: number | null;
};

export async function getRosterAction(
  rawSessionId: string,
): Promise<{
  batchName: string;
  startsAt: string;
  rows: RosterRow[];
  offlineSyncEnabled: boolean;
} | null> {
  const sessionId = sessionIdSchema.parse(rawSessionId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);

  return withTenant(ctx.tenantId, async (tx) => {
    const [session] = await tx
      .select({
        id: sessions.id,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        batchId: batches.id,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)));
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
      startsAt: session.startsAt.toISOString(),
      rows,
      offlineSyncEnabled: tenant.offlineSyncEnabled,
    };
  });
}

export async function markAttendanceSessionAction(raw: {
  sessionId: string;
  memberId: string;
  status: "present" | "absent" | "late";
  clientId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const input = markAttendanceSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);

  if (!(await sessionExistsInTenant(ctx, input.sessionId))) {
    return { ok: false, error: "Session not found." };
  }

  await markAttendance(ctx, input);
  return { ok: true };
}
