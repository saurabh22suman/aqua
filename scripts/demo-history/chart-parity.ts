import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { getOwnerCharts } from "@/lib/services/owner-home-charts";
import { resolveOwnerPeriod, type OwnerPeriodKey } from "@/lib/time/owner-periods";
import { asTenantId, asUserId } from "@/lib/ids";
import { toSafePaise } from "@/lib/money/safe-paise";

// Chart parity.
//
// One question: do the owner's charts show the numbers the database
// actually holds? It answers it by running the application's OWN chart
// service (lib/services/owner-home-charts.ts) and then re-reading the
// same rows over the chart's EXACT window (the same instants, the same
// filters), comparing the two figures to the paisa.
//
// It is a read-only check. It never writes a chart value and never
// feeds the chart: the chart reads the tables, this compares what the
// chart read with what the tables hold.

export type PeriodParity = {
  period: OwnerPeriodKey;
  label: string;
  from: string;
  to: string;
  fromIso: string;
  toIso: string;
  /** What the chart service reports. */
  chart: {
    collectionsPaise: number;
    paymentCount: number;
    attendanceMarks: number;
    attendancePresent: number;
    attendancePct: number | null;
  };
  /** What the underlying rows add up to over the same instants. */
  rows: {
    collectionsPaise: number;
    paymentCount: number;
    attendanceMarks: number;
    attendancePresent: number;
    attendancePct: number | null;
  };
  /** True when the chart and the rows agree exactly. */
  matches: boolean;
};

export type ChartParity = {
  periods: PeriodParity[];
  allMatch: boolean;
};

export async function readChartParity(args: {
  tenantId: string;
  nowMs: number;
}): Promise<ChartParity> {
  const { tenantId, nowMs } = args;
  const scope = asTenantId(tenantId);
  const ctx = {
    tenantId: scope,
    userId: asUserId(randomUUID()),
    roleKey: "owner",
    allLocations: true,
    locationIds: [] as string[],
    permissions: new Set([
      "dashboard.view",
      "reports.financial",
      "payments.read",
      "invoices.read",
    ]),
  };

  const periods: PeriodParity[] = [];
  for (const key of ["day", "week", "month"] as const) {
    const period = resolveOwnerPeriod(key, nowMs);
    const charts = await getOwnerCharts(ctx, { period: key, now: nowMs });
    const from = new Date(period.current.fromIso);
    const to = new Date(period.current.toIso);

    // The same rows the chart reads, over the same instants.
    const rows = await withTenant(tenantId, async (tx) => {
      const [collected] = await tx
        .select({
          paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(payments)
        .where(
          and(
            eq(payments.tenantId, scope),
            eq(payments.status, "captured"),
            gte(payments.receivedAt, from),
            lt(payments.receivedAt, to),
          ),
        );

      const [marks] = await tx
        .select({
          marks: sql<number>`count(${attendance.id})::int`,
          present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
        })
        .from(attendance)
        .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
        .innerJoin(batches, eq(batches.id, sessions.batchId))
        .where(
          and(
            eq(attendance.tenantId, scope),
            sql`${sessions.status} <> 'cancelled'`,
            gte(attendance.markedAt, from),
            lt(attendance.markedAt, to),
          ),
        );

      const attendanceMarks = Number(marks?.marks ?? 0);
      const attendancePresent = Number(marks?.present ?? 0);
      return {
        collectionsPaise: toSafePaise(collected?.paise ?? "0"),
        paymentCount: Number(collected?.count ?? 0),
        attendanceMarks,
        attendancePresent,
        attendancePct:
          attendanceMarks > 0
            ? Math.round((attendancePresent / attendanceMarks) * 100)
            : null,
      };
    });

    const chart = {
      collectionsPaise: charts.collections.totalPaise,
      paymentCount: charts.collections.paymentCount,
      attendanceMarks: charts.attendance.total,
      attendancePresent: charts.attendance.present,
      attendancePct: charts.attendance.pct,
    };

    periods.push({
      period: key,
      label: period.tabLabel,
      from: period.current.fromDate,
      to: period.current.toDate,
      fromIso: period.current.fromIso,
      toIso: period.current.toIso,
      chart,
      rows,
      matches:
        chart.collectionsPaise === rows.collectionsPaise &&
        chart.paymentCount === rows.paymentCount &&
        chart.attendanceMarks === rows.attendanceMarks &&
        chart.attendancePresent === rows.attendancePresent &&
        chart.attendancePct === rows.attendancePct,
    });
  }

  return { periods, allMatch: periods.every((period) => period.matches) };
}
