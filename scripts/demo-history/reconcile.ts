import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { payments } from "@/db/schema/payments";
import { invoices } from "@/db/schema/invoices";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { dayRangeUtc, addDays } from "@/lib/time/tz";
import { toSafePaise } from "@/lib/money/safe-paise";
import { methodGroup, type PaymentGroupKey } from "@/lib/money/payment-groups";
import { asTenantId } from "@/lib/ids";
import type { TenantTx } from "@/db/tenant";

// The reconciliation.
//
// These are the SAME reads the owner's charts do, over the SAME
// window: captured payments bucketed by the tenant's local day, and
// attendance marks bucketed by the instant the register was filled in.
// The summary carries them so a reviewer can put the chart next to the
// underlying records and see that they agree — instead of taking the
// chart's word for it.
//
// Nothing here fabricates a figure: every number is a sum over rows
// that exist in the database after the write.

export type Reconciliation = {
  window: { from: string; to: string; timezone: string };
  collections: {
    totalPaise: number;
    paymentCount: number;
    byMethod: Record<string, { paise: number; count: number }>;
    byGroup: Record<string, { paise: number; count: number }>;
    byDay: { date: string; paise: number; count: number }[];
    daysWithPayments: number;
    daysWithoutPayments: number;
    /** Payments dated after the window — must always be zero. */
    paymentsOutsideWindow: number;
  };
  attendance: {
    marks: number;
    present: number;
    pct: number | null;
    byDay: { date: string; marks: number; present: number }[];
    daysWithMarks: number;
    daysWithoutMarks: number;
  };
  dues: {
    invoices: number;
    byStatus: Record<string, number>;
    outstandingPaise: number;
    overduePaise: number;
    overdueCount: number;
    partPaidCount: number;
    unpaidCount: number;
  };
};

export async function reconcileDemoHistory(
  tx: TenantTx,
  args: {
    tenantId: string;
    timezone: string;
    from: string;
    to: string;
    today: string;
  },
): Promise<Reconciliation> {
  const { tenantId, timezone, from, to, today } = args;
  const tenantScope = asTenantId(tenantId);
  const { fromUtc } = dayRangeUtc(from, timezone);
  // The window's last day is inclusive, so the upper bound is the day
  // after it.
  const { fromUtc: windowEndUtc } = dayRangeUtc(addDays(to, 1), timezone);

  const paymentRows = await tx
    .select({
      day: sql<string>`to_char((${payments.receivedAt} at time zone ${timezone})::date, 'YYYY-MM-DD')`,
      method: payments.method,
      paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantScope),
        eq(payments.status, "captured"),
        gte(payments.receivedAt, fromUtc),
        lt(payments.receivedAt, windowEndUtc),
      ),
    )
    .groupBy(sql`1`, payments.method);

  const byMethod: Record<string, { paise: number; count: number }> = {};
  const byDayMap = new Map<string, { paise: number; count: number }>();
  let totalPaise = 0;
  let paymentCount = 0;
  for (const row of paymentRows) {
    const paise = toSafePaise(row.paise);
    const count = Number(row.count);
    const method = byMethod[row.method] ?? { paise: 0, count: 0 };
    method.paise += paise;
    method.count += count;
    byMethod[row.method] = method;
    totalPaise += paise;
    paymentCount += count;
    const day = byDayMap.get(row.day) ?? { paise: 0, count: 0 };
    day.paise += paise;
    day.count += count;
    byDayMap.set(row.day, day);
  }

  const byGroup: Record<string, { paise: number; count: number }> = {};
  for (const [method, totals] of Object.entries(byMethod)) {
    const group = methodGroup(method) as PaymentGroupKey;
    const entry = byGroup[group] ?? { paise: 0, count: 0 };
    entry.paise += totals.paise;
    entry.count += totals.count;
    byGroup[group] = entry;
  }

  const byDay = [...byDayMap.entries()]
    .map(([date, totals]) => ({ date, paise: totals.paise, count: totals.count }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const [outside] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantScope),
        eq(payments.status, "captured"),
        sql`(${payments.receivedAt} < ${fromUtc} or ${payments.receivedAt} >= ${windowEndUtc})`,
      ),
    );

  // Attendance, bucketed the way the owner's chart buckets it: by the
  // instant the register was filled in, not by the session's date.
  const attendanceRows = await tx
    .select({
      day: sql<string>`to_char((${attendance.markedAt} at time zone ${timezone})::date, 'YYYY-MM-DD')`,
      marks: sql<number>`count(${attendance.id})::int`,
      present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
    })
    .from(attendance)
    .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
    .innerJoin(batches, eq(batches.id, sessions.batchId))
    .where(
      and(
        eq(attendance.tenantId, tenantScope),
        sql`${sessions.status} <> 'cancelled'`,
        gte(attendance.markedAt, fromUtc),
        lt(attendance.markedAt, windowEndUtc),
      ),
    )
    .groupBy(sql`1`);

  const attendanceByDay = attendanceRows
    .map((row) => ({
      date: row.day,
      marks: Number(row.marks),
      present: Number(row.present),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const marks = attendanceByDay.reduce((sum, row) => sum + row.marks, 0);
  const present = attendanceByDay.reduce((sum, row) => sum + row.present, 0);

  const invoiceRows = await tx
    .select({
      status: invoices.status,
      totalPaise: sql<string>`coalesce(sum(${invoices.totalPaise}), 0)::text`,
      paidPaise: sql<string>`coalesce(sum(${invoices.paidPaise}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantScope),
        inArray(invoices.status, ["issued", "partial", "paid"]),
      ),
    )
    .groupBy(invoices.status);

  const byStatus: Record<string, number> = {};
  let outstandingPaise = 0;
  for (const row of invoiceRows) {
    byStatus[row.status] = Number(row.count);
    outstandingPaise += toSafePaise(row.totalPaise) - toSafePaise(row.paidPaise);
  }

  const [overdue] = await tx
    .select({
      paise: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantScope),
        inArray(invoices.status, ["issued", "partial"]),
        sql`${invoices.totalPaise} > ${invoices.paidPaise}`,
        sql`${invoices.dueOn} < ${today}`,
      ),
    );

  const [partPaid] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantScope),
        eq(invoices.status, "partial"),
      ),
    );

  const windowDays = daysBetween(from, to) + 1;
  return {
    window: { from, to, timezone },
    collections: {
      totalPaise,
      paymentCount,
      byMethod,
      byGroup,
      byDay,
      daysWithPayments: byDay.length,
      daysWithoutPayments: Math.max(0, windowDays - byDay.length),
      paymentsOutsideWindow: Number(outside?.count ?? 0),
    },
    attendance: {
      marks,
      present,
      pct: marks > 0 ? Math.round((present / marks) * 100) : null,
      byDay: attendanceByDay,
      daysWithMarks: attendanceByDay.length,
      daysWithoutMarks: Math.max(0, windowDays - attendanceByDay.length),
    },
    dues: {
      invoices: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      byStatus,
      outstandingPaise,
      overduePaise: toSafePaise(overdue?.paise ?? "0"),
      overdueCount: Number(overdue?.count ?? 0),
      partPaidCount: Number(partPaid?.count ?? 0),
      unpaidCount: byStatus.issued ?? 0,
    },
  };
}

function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}
