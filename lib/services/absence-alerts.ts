import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { absenceAlerts, type AbsenceAlertKind } from "@/db/schema/absence-alerts";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { tenants } from "@/db/schema/tenants";
import { resolveConfigInTx, setTenantConfigValue } from "@/db/config";
import { addDays, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

// O-04 — the threshold is a configuration-registry value
// (attendance.absence_alert_threshold_pct, default 50). Reads and
// writes go through the resolver so the value carries provenance and
// the ops console sees it like every other key.
const THRESHOLD_KEY = "attendance.absence_alert_threshold_pct" as const;

// R.8 (docs/five-day-work-guide.md, V-20) — absence alerts.
//
// Owner decisions 2026-09-13: threshold configurable (default 50%);
// the monthly alert needs >= 4 recorded marks (fixed noise guard);
// in-app only; read-only. The daily job calls detectAbsenceAlerts once
// per tenant; the unique key (tenant, member, batch, kind, week) makes
// the run idempotent, so three consecutive absences produce one alert,
// not one per day.

const MIN_MONTHLY_MARKS = 4;
const STREAK_LENGTH = 3;
const LOOKBACK_DAYS = 56;

export type DetectAbsenceAlertsResult = {
  inserted: number;
  candidates: number;
};

export async function getAbsenceAlertThreshold(ctx: ActionCtx): Promise<number> {
  return withTenant(ctx.tenantId, async (tx) => {
    const resolved = await resolveConfigInTx<number>(
      tx,
      ctx.tenantId,
      THRESHOLD_KEY,
    );
    return resolved.value;
  });
}

export async function updateAbsenceAlertThreshold(
  ctx: ActionCtx,
  thresholdPct: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(thresholdPct) || thresholdPct < 0 || thresholdPct > 100) {
    return { ok: false, error: "Threshold must be a whole number from 0 to 100." };
  }
  const result = await setTenantConfigValue({
    tenantId: ctx.tenantId,
    key: THRESHOLD_KEY,
    value: thresholdPct,
    actorId: ctx.userId,
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

// ISO-8601 week key ("2026-W37") for the tenant's local date.
export function isoWeekKey(dateIso: string): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function detectAbsenceAlerts(
  ctx: ActionCtx,
): Promise<DetectAbsenceAlertsResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    if (!tenant) return { inserted: 0, candidates: 0 };
    const { value: threshold } = await resolveConfigInTx<number>(
      tx,
      ctx.tenantId,
      THRESHOLD_KEY,
    );

    const today = todayInZone(tenant.timezone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const since = addDays(today, -LOOKBACK_DAYS);

    const rows = await tx
      .select({
        memberId: attendance.memberId,
        batchId: sessions.batchId,
        sessionDate: sessions.sessionDate,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          gte(sessions.sessionDate, since),
          lte(sessions.sessionDate, today),
        ),
      )
      .orderBy(
        asc(attendance.memberId),
        asc(sessions.batchId),
        desc(sessions.sessionDate),
      );

    type Group = {
      memberId: string;
      batchId: string;
      marks: Array<{ sessionDate: string; status: string }>;
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const key = `${r.memberId}:${r.batchId}`;
      const group = groups.get(key) ?? {
        memberId: r.memberId,
        batchId: r.batchId,
        marks: [],
      };
      group.marks.push({ sessionDate: r.sessionDate, status: r.status });
      groups.set(key, group);
    }

    const week = isoWeekKey(today);
    const toInsert: Array<{
      memberId: string;
      batchId: string;
      alertKind: AbsenceAlertKind;
      detail: Record<string, unknown>;
    }> = [];

    for (const group of groups.values()) {
      // marks are newest-first.
      let streak = 0;
      for (const mark of group.marks) {
        if (mark.status === "absent") streak += 1;
        else break;
      }
      if (streak >= STREAK_LENGTH) {
        toInsert.push({
          memberId: group.memberId,
          batchId: group.batchId,
          alertKind: "consecutive_absences",
          detail: { streak },
        });
      }

      const monthly = group.marks.filter((m) => m.sessionDate >= monthStart);
      const total = monthly.length;
      const present = monthly.filter(
        (m) => m.status === "present" || m.status === "late",
      ).length;
      if (total >= MIN_MONTHLY_MARKS) {
        const pct = Math.round((present / total) * 100);
        if (pct < threshold) {
          toInsert.push({
            memberId: group.memberId,
            batchId: group.batchId,
            alertKind: "low_monthly_attendance",
            detail: { pct, total },
          });
        }
      }
    }

    if (toInsert.length === 0) return { inserted: 0, candidates: 0 };

    const inserted = await tx
      .insert(absenceAlerts)
      .values(
        toInsert.map((a) => ({
          tenantId: ctx.tenantId,
          memberId: asMemberId(a.memberId),
          batchId: a.batchId,
          alertKind: a.alertKind,
          calendarWeek: week,
          detail: a.detail,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: absenceAlerts.id });

    return { inserted: inserted.length, candidates: toInsert.length };
  });
}

export type MemberAlertRow = {
  alertId: string;
  alertKind: AbsenceAlertKind;
  batchName: string;
  calendarWeek: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
};

export async function listMemberAlerts(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberAlertRow[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        alertId: absenceAlerts.id,
        alertKind: absenceAlerts.alertKind,
        batchName: batches.name,
        calendarWeek: absenceAlerts.calendarWeek,
        detail: absenceAlerts.detail,
        createdAt: absenceAlerts.createdAt,
      })
      .from(absenceAlerts)
      .innerJoin(batches, eq(batches.id, absenceAlerts.batchId))
      .where(
        and(
          eq(absenceAlerts.tenantId, ctx.tenantId),
          eq(absenceAlerts.memberId, asMemberId(memberId)),
        ),
      )
      .orderBy(desc(absenceAlerts.createdAt))
      .limit(5),
  ) as Promise<MemberAlertRow[]>;
}
