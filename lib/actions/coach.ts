"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { NotFoundError, requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
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
import { emitActivityEvents } from "@/lib/events/emit";
import { isCoachLikeRoleKey } from "@/lib/services/resource-access";
import { offlineSessionState } from "@/lib/offline/server-session";
import type { OfflineIdentity } from "@/lib/offline/identity";
import { OFFLINE_SYNC_ENABLED } from "@/lib/feature-flags";

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
  requirePermission(ctx, "attendance.read");

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
  requirePermission(ctx, "attendance.read");
  if (!isCoachLikeRoleKey(ctx.roleKey)) {
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
  requirePermission(ctx, "attendance.read");

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
  offlineIdentity?: OfflineIdentity | null;
} | null> {
  const sessionId = sessionIdSchema.parse(rawSessionId);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");

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
    offlineIdentity: roster.offlineSyncEnabled && OFFLINE_SYNC_ENABLED ? (await offlineSessionState()).identity : null,
  };
}

export async function markAttendanceSessionAction(raw: {
  sessionId: string;
  memberId: string;
  status: "present" | "absent" | "late";
  clientId: string;
  offlineScope?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const input = markAttendanceSchema.parse(raw);
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.mark");
  // R01 — Owner/Admin are read-only over student attendance even if a
  // stale or tenant-edited grant survives (the service refuses too;
  // this returns the truthful counter message instead of a not-found).
  if (ctx.roleKey === "owner" || ctx.roleKey === "admin") {
    return { ok: false, error: "Student attendance is recorded by the coach or the front desk." };
  }
  if (input.offlineScope && (await offlineSessionState()).identity?.scope !== input.offlineScope) {
    return { ok: false, error: "Your offline session changed. Sign in again before syncing." };
  }

  const visible = await sessionVisibleToCaller(
    { tenantId: ctx.tenantId, userId: ctx.userId, roleKey: ctx.roleKey },
    input.sessionId,
  );
  if (!visible) {
    return { ok: false, error: "Session not found." };
  }

  try { await markAttendance(ctx, input); }
  catch (error) {
    if (error instanceof NotFoundError) return { ok: false, error: "Session or eligible member not found." };
    throw error;
  }

  // E-05 — emit after the mutation transaction has committed, never
  // inside it (architecture.md §8.11). Properties carry opaque ids and
  // the status only: no member name, no DOB, no PII. clientEventId is
  // the register's existing per-mark clientId, so the event is
  // attributable to the same mark the attendance upsert dedupes; the
  // pg-boss payload freezes occurred_at, which is what makes a job
  // redelivery insert exactly one row. A fresh action invocation with
  // the same clientId but a new occurred_at is a new event — the
  // stream is at-least-once analytics, not a ledger.
  await emitActivityEvents(ctx.tenantId, [
    {
      eventName: "session.attendance_marked",
      occurredAt: new Date(),
      clientEventId: input.clientId,
      actorId: ctx.userId,
      actorKind: "user",
      requestId: ctx.requestId,
      entityType: "session",
      entityId: input.sessionId,
      properties: {
        sessionId: input.sessionId,
        memberId: input.memberId,
        status: input.status,
      },
      context: {},
      source: "web",
    },
  ]).catch(error => {
    // The mark and its authoritative audit have committed. An analytics
    // outage must not report a saved mark as failed and trigger blind retries.
    console.error("[attendance] activity enqueue failed", { tenantId: ctx.tenantId, requestId: ctx.requestId, error });
  });

  return { ok: true };
}

export async function getCoachRosterAction(): Promise<CoachRosterRow[]> {
  const ctx = await requireDefaultCtx();
  // D2: coach roster reads use members.read.assigned, not
  // members.read. Coach holds members.read.assigned; coach does NOT
  // hold members.read (that's the full-roster grant for owner /
  // admin / receptionist). The service layer scopes by
  // coachStaffIdSubquery, so the coach sees only the members
  // attached to their own batches even though the permission
  // itself is granted to every coach.
  requirePermission(ctx, "members.read.assigned");
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
  requirePermission(ctx, "members.read.assigned");
  return getCoachMemberDetail(
    { tenantId: ctx.tenantId, userId: ctx.userId ?? "" },
    memberId,
  );
}
