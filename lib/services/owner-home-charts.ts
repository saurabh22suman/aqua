import { and, eq, gte, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { paymentReversals } from "@/db/schema/payment-reversals";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { tenants } from "@/db/schema/tenants";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import {
  comparisonText,
  formatInstantRange,
  periodBuckets,
  resolveOwnerPeriod,
  type OwnerPeriodKey,
} from "@/lib/time/owner-periods";
import {
  GROUP_LABEL,
  METHOD_LABEL,
  PAYMENT_GROUPS,
  methodGroup,
  type PaymentGroupKey,
  type PaymentMethodKey,
  isPaymentMethod,
} from "@/lib/money/payment-groups";
import { toSafePaise } from "@/lib/money/safe-paise";
import type { ActionCtx } from "@/lib/auth/context";

// Owner Home chart data. Two panels, one period:
//
//   Collections — captured payments, stacked by group (Cash / Digital /
//   Other) per bucket of the selected period. "Digital" is UPI + bank
//   transfer + card; "other" stays its own bucket. Reversals are
//   reported beside the total (ledger-only, not netted), matching the
//   Fees hub and the daily collections report.
//
//   Attendance — present/late marks over marks recorded, per bucket.
//   A bucket with no marks is UNKNOWN (null), never 0%.
//
// Both are read inside one tenant transaction under the caller's
// resolved location access, so the figures and their drill-down share
// the same scope.

export type ChartMetric = "collections" | "attendance";

export type CollectionsBucket = {
  key: string;
  label: string;
  fullLabel: string;
  cash: number;
  digital: number;
  other: number;
  totalPaise: number;
};

export type GroupTotal = {
  key: PaymentGroupKey;
  label: string;
  paise: number;
  count: number;
  pct: number;
};

export type MethodTotal = {
  key: PaymentMethodKey;
  label: string;
  group: PaymentGroupKey;
  paise: number;
  count: number;
  pct: number;
};

export type AttendanceBucket = {
  key: string;
  label: string;
  fullLabel: string;
  present: number;
  total: number;
  /** null = no marks recorded in this bucket (unknown, not zero). */
  pct: number | null;
};

export type OwnerChartsData = {
  timezone: string;
  period: {
    key: OwnerPeriodKey;
    tabLabel: string;
    comparisonLabel: string;
    comparisonMeaning: string;
    currentLabel: string;
    previousLabel: string;
    currentFromDate: string;
    currentToDate: string;
    previousFromDate: string;
    previousToDate: string;
    previousCapped: boolean;
    capNote: string | null;
  };
  collections: {
    buckets: CollectionsBucket[];
    groups: GroupTotal[];
    methods: MethodTotal[];
    totalPaise: number;
    paymentCount: number;
    previousTotalPaise: number;
    previousPaymentCount: number;
    /** True when no payment was captured in the comparison range. */
    previousIsZero: boolean;
    reversedPaise: number;
    reversalCount: number;
    comparison: string;
  };
  attendance: {
    buckets: AttendanceBucket[];
    present: number;
    total: number;
    pct: number | null;
    previousPresent: number;
    previousTotal: number;
    previousPct: number | null;
    comparison: string;
  };
};

export type OwnerChartsOptions = {
  period?: OwnerPeriodKey;
  locationId?: string;
  now?: number;
};

export async function getOwnerCharts(
  ctx: ActionCtx,
  options: OwnerChartsOptions = {},
): Promise<OwnerChartsData> {
  const period = resolveOwnerPeriod(options.period ?? "day", options.now);
  const locationId = options.locationId;
  // Only buckets that have started: a period-to-date axis must not show
  // future slots as if they were empty data.
  const bucketDefs = periodBuckets(period).filter(
    (bucket) => bucket.startIso < period.current.toIso,
  );

  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenant?.timezone ?? "Asia/Kolkata";
    const access = await resolveLocationAccess(tx, ctx);

    const paymentScope = (column: typeof payments.locationId) => {
      const parts = [locationPredicate(column, access)];
      if (locationId) parts.push(eq(column, locationId));
      return parts.filter((part): part is NonNullable<typeof part> => Boolean(part));
    };

    const paymentWindow = and(
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, new Date(period.current.fromIso)),
      lt(payments.receivedAt, new Date(period.current.toIso)),
      ...paymentScope(payments.locationId),
    );
    const previousWindow = and(
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, new Date(period.previous.fromIso)),
      lt(payments.receivedAt, new Date(period.previous.toIso)),
      ...paymentScope(payments.locationId),
    );

    const bucketExpr =
      period.key === "day"
        ? sql<string>`to_char(date_trunc('hour', ${payments.receivedAt} at time zone ${timezone}), 'HH24')`
        : sql<string>`(${payments.receivedAt} at time zone ${timezone})::date::text`;

    // The tenant-local bucket is computed in a derived table so the
    // timezone is bound once; binding it again in GROUP BY makes
    // Postgres treat it as a different expression (see the same fix in
    // owner-analytics).
    const scopedPayments = tx
      .select({
        bucket: bucketExpr.as("bucket"),
        method: payments.method,
        paise: payments.amountPaise,
      })
      .from(payments)
      .where(paymentWindow)
      .as("scoped_payments");
    const byBucketMethod = await tx
      .select({
        bucket: scopedPayments.bucket,
        method: scopedPayments.method,
        paise: sql<string>`coalesce(sum(${scopedPayments.paise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(scopedPayments)
      .groupBy(scopedPayments.bucket, scopedPayments.method);

    const byMethod = await tx
      .select({
        method: payments.method,
        paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(paymentWindow)
      .groupBy(payments.method);

    const [previousTotals] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(previousWindow);

    const reversalConditions = [
      eq(paymentReversals.tenantId, ctx.tenantId),
      gte(paymentReversals.createdAt, new Date(period.current.fromIso)),
      lt(paymentReversals.createdAt, new Date(period.current.toIso)),
      ...paymentScope(payments.locationId),
    ];
    const [reversed] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${paymentReversals.amountPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(paymentReversals)
      .innerJoin(
        payments,
        and(
          eq(payments.id, paymentReversals.paymentId),
          eq(payments.tenantId, paymentReversals.tenantId),
        ),
      )
      .where(and(...reversalConditions));

    const buckets = bucketDefs.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      fullLabel: bucket.fullLabel,
      cash: 0,
      digital: 0,
      other: 0,
      totalPaise: 0,
    }));
    const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
    const methodTotals = new Map<string, { paise: number; count: number }>();
    for (const row of byBucketMethod) {
      const bucket = byKey.get(row.bucket);
      const paise = toSafePaise(row.paise);
      if (bucket) {
        bucket[methodGroup(row.method)] += paise;
        bucket.totalPaise += paise;
      }
    }
    let totalPaise = 0;
    let paymentCount = 0;
    for (const row of byMethod) {
      const paise = toSafePaise(row.paise);
      totalPaise += paise;
      paymentCount += Number(row.count);
      methodTotals.set(row.method, { paise, count: Number(row.count) });
    }

    const share = (paise: number) =>
      totalPaise > 0 ? Math.round((paise / totalPaise) * 100) : 0;
    const methods: MethodTotal[] = (["cash", "upi", "bank_transfer", "card", "other"] as const)
      .filter((method): method is PaymentMethodKey => isPaymentMethod(method))
      .map((method) => {
        const row = methodTotals.get(method) ?? { paise: 0, count: 0 };
        return {
          key: method,
          label: METHOD_LABEL[method],
          group: methodGroup(method),
          paise: row.paise,
          count: row.count,
          pct: share(row.paise),
        };
      });
    const groups: GroupTotal[] = PAYMENT_GROUPS.map((group) => {
      const paise = methods
        .filter((method) => method.group === group)
        .reduce((sum, method) => sum + method.paise, 0);
      const count = methods
        .filter((method) => method.group === group)
        .reduce((sum, method) => sum + method.count, 0);
      return { key: group, label: GROUP_LABEL[group], paise, count, pct: share(paise) };
    });

    const previousTotalPaise = toSafePaise(previousTotals?.paise ?? "0");
    const previousPaymentCount = Number(previousTotals?.count ?? 0);

    // Attendance: marks recorded in each bucket, present/late out of all
    // marks. Buckets without marks stay null.
    const attendanceBucketExpr =
      period.key === "day"
        ? sql<string>`to_char(date_trunc('hour', ${attendance.markedAt} at time zone ${timezone}), 'HH24')`
        : sql<string>`(${attendance.markedAt} at time zone ${timezone})::date::text`;
    const batchAccess = locationPredicate(batches.locationId, access);
    const attendanceScope = and(
      eq(attendance.tenantId, ctx.tenantId),
      ...(locationId ? [eq(batches.locationId, locationId)] : []),
      ...(batchAccess ? [batchAccess] : []),
    );

    const scopedAttendance = tx
      .select({
        bucket: attendanceBucketExpr.as("bucket"),
        id: attendance.id,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          attendanceScope,
          sql`${sessions.status} <> 'cancelled'`,
          gte(attendance.markedAt, new Date(period.current.fromIso)),
          lt(attendance.markedAt, new Date(period.current.toIso)),
        ),
      )
      .as("scoped_attendance");
    const attendanceByBucket = await tx
      .select({
        bucket: scopedAttendance.bucket,
        present: sql<number>`count(*) filter (where ${scopedAttendance.status} in ('present', 'late'))::int`,
        total: sql<number>`count(${scopedAttendance.id})::int`,
      })
      .from(scopedAttendance)
      .groupBy(scopedAttendance.bucket);

    const [previousAttendance] = await tx
      .select({
        present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
        total: sql<number>`count(${attendance.id})::int`,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          attendanceScope,
          sql`${sessions.status} <> 'cancelled'`,
          gte(attendance.markedAt, new Date(period.previous.fromIso)),
          lt(attendance.markedAt, new Date(period.previous.toIso)),
        ),
      );

    const attendanceBuckets: AttendanceBucket[] = bucketDefs.map((bucket) => {
      const row = attendanceByBucket.find((entry) => entry.bucket === bucket.key);
      const total = Number(row?.total ?? 0);
      const present = Number(row?.present ?? 0);
      return {
        key: bucket.key,
        label: bucket.label,
        fullLabel: bucket.fullLabel,
        present,
        total,
        pct: total > 0 ? Math.round((present / total) * 100) : null,
      };
    });
    const present = attendanceBuckets.reduce((sum, bucket) => sum + bucket.present, 0);
    const total = attendanceBuckets.reduce((sum, bucket) => sum + bucket.total, 0);
    const previousPresent = Number(previousAttendance?.present ?? 0);
    const previousTotal = Number(previousAttendance?.total ?? 0);

    const attendanceComparison =
      previousTotal === 0
        ? present > 0
          ? "No previous marks in the comparison range"
          : "No marks in either range"
        : `${present} of ${total} marks against ${previousPresent} of ${previousTotal} in the previous range`;

    return {
      timezone,
      period: {
        key: period.key,
        tabLabel: period.tabLabel,
        comparisonLabel: period.comparisonLabel,
        comparisonMeaning: period.comparisonMeaning,
        currentLabel: formatInstantRange(period.current.fromIso, period.current.toIso),
        previousLabel: formatInstantRange(period.previous.fromIso, period.previous.toIso),
        currentFromDate: period.current.fromDate,
        currentToDate: period.current.toDate,
        previousFromDate: period.previous.fromDate,
        previousToDate: period.previous.toDate,
        previousCapped: period.previous.capped,
        capNote: period.previous.capNote,
      },
      collections: {
        buckets,
        groups,
        methods,
        totalPaise,
        paymentCount,
        previousTotalPaise,
        previousPaymentCount,
        previousIsZero: previousPaymentCount === 0,
        reversedPaise: toSafePaise(reversed?.paise ?? "0"),
        reversalCount: Number(reversed?.count ?? 0),
        comparison: comparisonText(totalPaise, previousPaymentCount === 0 ? 0 : previousTotalPaise),
      },
      attendance: {
        buckets: attendanceBuckets,
        present,
        total,
        pct: total > 0 ? Math.round((present / total) * 100) : null,
        previousPresent,
        previousTotal,
        previousPct:
          previousTotal > 0 ? Math.round((previousPresent / previousTotal) * 100) : null,
        comparison: attendanceComparison,
      },
    };
  });
}
