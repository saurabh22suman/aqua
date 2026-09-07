"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema";
import { addDays, todayInZone } from "@/lib/time/tz";
import { listCoachRoster, listCoachSchedule, getCoachNextUpcoming } from "@/lib/services/coach-schedule";
import { getCoachMemberDetail, type CoachMemberDetail } from "@/lib/services/coach-member";
import {
  getRosterForSession,
  listTodaySessions,
  markAttendance,
  sessionVisibleToCaller,
  type RosterRow,
} from "@/lib/services/register";
import { coachScheduleSchema, markAttendanceSchema, sessionIdSchema } from "@/lib/schemas";

const memberIdSchema = z.string().uuid();
import type { CoachRosterRow, CoachScheduleRow } from "@/lib/services/coach-schedule";

export type TodaySession = {
  id: string;
  batchName: string;
  startsAt: string;
  endsAt: string;
  marked: number;
  total: number;
  sessionDate?: string;
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

// Coach home view — today's sessions plus the next upcoming session
// for the empty state. Reception doesn't get the empty-state treatment:
// they observe, not act. The next-session lookup is coach-scoped so a
// coach never sees another coach's batch through this path. Returns
// the soonest future session within a 7-day window.
export async function getCoachHomeAction(): Promise<{
  sessions: TodaySession[];
  next: TodaySession | null;
}> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  if (ctx.roleKey !== "coach") {
    // Reception and other staff see only today; the home-page empty
    // state is a coach-only thing.
    const today = await getTodayAction();
    return { sessions: today.sessions, next: null };
  }

  const [tenant] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
  );
  const today = todayInZone(tenant.timezone);

  const [todayRows, nextRow] = await Promise.all([
    listTodaySessions(
      { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
      today,
    ),
    getCoachNextUpcoming(
      { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
      today,
      7,
    ),
  ]);

  return {
    sessions: todayRows.map((r) => ({
      id: r.id,
      batchName: r.batchName,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      marked: r.marked,
      total: r.total,
    })),
    next: nextRow
      ? {
          id: nextRow.id,
          batchName: nextRow.batchName,
          startsAt: nextRow.startsAt.toISOString(),
          endsAt: nextRow.endsAt.toISOString(),
          marked: nextRow.marked,
          total: nextRow.total,
          sessionDate: nextRow.sessionDate,
        }
      : null,
  };
}

export type { RosterRow };

export async function getScheduleAction(raw: {
  days?: number;
}): Promise<{
  from: string;
  to: string;
  days: Array<{ date: string; sessions: CoachScheduleRow[] }>;
}> {
  const input = coachScheduleSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);

  const [tenant] = await withTenant(ctx.tenantId, (tx) =>
    tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId)),
  );
  const daysAhead = input.days ?? 7;
  const from = todayInZone(tenant.timezone);
  const to = addDays(from, daysAhead - 1);

  const rows = await listCoachSchedule(
    { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
    from,
    to,
  );

  const byDate = new Map<string, CoachScheduleRow[]>();
  for (const r of rows) {
    const list = byDate.get(r.sessionDate) ?? [];
    list.push(r);
    byDate.set(r.sessionDate, list);
  }

  const days: Array<{ date: string; sessions: CoachScheduleRow[] }> = [];
  for (let i = 0; i < daysAhead; i++) {
    const date = addDays(from, i);
    days.push({ date, sessions: byDate.get(date) ?? [] });
  }

  return { from, to, days };
}

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

  // getRosterForSession returns null identically for "no such session"
  // and "session exists, but not this caller's to see" -- a coach
  // requesting another coach's session gets the same 404 a made-up
  // session id would produce, never a 403 that would confirm the id
  // was real.
  const roster = await getRosterForSession(
    { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
    sessionId,
  );
  if (!roster) return null;

  return {
    batchName: roster.batchName,
    startsAt: roster.startsAt.toISOString(),
    rows: roster.rows,
    offlineSyncEnabled: roster.offlineSyncEnabled,
  };
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

  const visible = await sessionVisibleToCaller(
    { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
    input.sessionId,
  );
  if (!visible) {
    return { ok: false, error: "Session not found." };
  }

  await markAttendance(ctx, input);
  return { ok: true };
}

export async function getCoachRosterAction(): Promise<CoachRosterRow[]> {
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return listCoachRoster({ tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey });
}

// Coach-scoped member lookup. The service returns null when the
// member isn't in any of this coach's batches — the page renders
// 404 so a coach can't probe ids that aren't theirs.
export async function getCoachMemberDetailAction(
  rawMemberId: string,
): Promise<CoachMemberDetail | null> {
  const memberId = memberIdSchema.parse(rawMemberId);
  const ctx = await requireDefaultCtx();
  assertStaff(ctx);
  return getCoachMemberDetail(
    { tenantId: ctx.tenantId, userId: ctx.userId ?? "" },
    memberId,
  );
}
