import { and, eq, gte, lte } from "drizzle-orm";
import { attendance, sessions } from "@/db/schema/scheduling";
import { asMemberId, asStaffId } from "@/lib/ids";
import { todayInZone } from "@/lib/time/tz";
import { historyId } from "./keys";
import type { WriteContext } from "./write-context";

// The operational side: the sessions that ran, the registers that were
// filled in, and the one repair the generator is allowed to make.
//
// A session the demo seed already created keeps ITS id (the generator
// addresses the row by tenant + batch + date, which is unique), so the
// marks it writes always point at a session that exists.

export async function writeSessions(ctx: WriteContext): Promise<Map<string, string>> {
  const { tx, tenantId, state, plan, counters, existing } = ctx;

  const sessionRows = await tx
    .select({
      id: sessions.id,
      batchId: sessions.batchId,
      sessionDate: sessions.sessionDate,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.tenantId, tenantId),
        gte(sessions.sessionDate, plan.window.from),
        lte(sessions.sessionDate, plan.window.to),
      ),
    );
  const sessionByKey = new Map<string, string>();
  for (const row of sessionRows) {
    sessionByKey.set(`${row.batchId}|${row.sessionDate}`, row.id);
  }

  const sessionIdByKey = new Map<string, string>();
  for (const session of plan.sessions) {
    const key = `${session.batchId}|${session.date}`;
    const known = sessionByKey.get(key);
    if (known) {
      existing.sessions += 1;
      sessionIdByKey.set(session.key, known);
      continue;
    }
    const rows = await tx
      .insert(sessions)
      .values({
        id: historyId(state.tenant.id, "session", session.key),
        tenantId,
        batchId: session.batchId,
        locationId: session.locationId,
        sessionDate: session.date,
        startsAt: new Date(session.startsAtIso),
        endsAt: new Date(session.endsAtIso),
        status: "held",
        coachId: session.coachId ? asStaffId(session.coachId) : null,
      })
      .onConflictDoNothing()
      .returning({ id: sessions.id });
    if (rows.length > 0) {
      counters.sessions += 1;
      sessionIdByKey.set(session.key, rows[0]!.id);
    } else {
      existing.sessions += 1;
      const fallback = sessionByKey.get(key);
      if (fallback) sessionIdByKey.set(session.key, fallback);
    }
  }
  return sessionIdByKey;
}

export async function writeAttendance(
  ctx: WriteContext,
  sessionIdByKey: Map<string, string>,
): Promise<number> {
  const { tx, tenantId, state, plan, counters, existing } = ctx;

  const markRows = await tx
    .select({
      id: attendance.id,
      sessionId: attendance.sessionId,
      memberId: attendance.memberId,
      markedAt: attendance.markedAt,
      sessionDate: sessions.sessionDate,
      sessionEndsAt: sessions.endsAt,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .where(
      and(
        eq(attendance.tenantId, tenantId),
        gte(sessions.sessionDate, plan.window.from),
        lte(sessions.sessionDate, plan.window.to),
      ),
    );
  const markByKey = new Map<string, { id: string; markedAt: Date }>();
  for (const row of markRows) {
    markByKey.set(`${row.sessionId}|${row.memberId}`, {
      id: row.id,
      markedAt: row.markedAt,
    });
  }

  // The repair, and it is the ONE non-additive thing this tool does:
  // the demo seed stamps every attendance mark with the clock of the
  // seed run, which drops three weeks of registers into a single hour
  // bucket. Every mark is re-stamped onto the instant its session
  // ended — the same rule the planner uses for the marks it creates.
  // Marks the plan does not cover (a session the plan left unmarked)
  // are repaired too: they exist, so their timestamp has to be honest.
  let restamped = 0;
  for (const row of markRows) {
    const markedLocal = todayInZone(
      state.tenant.timezone,
      row.markedAt.getTime(),
    );
    if (markedLocal === row.sessionDate) continue;
    const target = new Date(row.sessionEndsAt.getTime() + 5 * 60_000);
    await tx
      .update(attendance)
      .set({ markedAt: target })
      .where(and(eq(attendance.id, row.id), eq(attendance.tenantId, tenantId)));
    restamped += 1;
  }

  for (const mark of plan.marks) {
    const sessionId = sessionIdByKey.get(mark.sessionKey);
    if (!sessionId) continue;
    const known = markByKey.get(`${sessionId}|${mark.memberId}`);
    if (known) {
      existing.marks += 1;
      continue;
    }
    const rows = await tx
      .insert(attendance)
      .values({
        id: historyId(state.tenant.id, "attendance", mark.key),
        tenantId,
        sessionId,
        memberId: asMemberId(mark.memberId),
        locationId: state.primaryLocationId,
        status: mark.status,
        clientId: mark.clientId,
        markedAt: new Date(mark.markedAtIso),
      })
      .onConflictDoNothing()
      .returning({ id: attendance.id });
    if (rows.length > 0) {
      counters.marks += 1;
    } else {
      existing.marks += 1;
    }
  }
  return restamped;
}
