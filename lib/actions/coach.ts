"use server";

import { eq } from "drizzle-orm";
import { requireDefaultCtx } from "@/lib/auth/context";
import { assertStaff } from "@/lib/auth/permissions";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema";
import { todayInZone } from "@/lib/time/tz";
import {
  getRosterForSession,
  listTodaySessions,
  markAttendance,
  sessionVisibleToCaller,
  type RosterRow,
} from "@/lib/services/register";
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

export type { RosterRow };

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
