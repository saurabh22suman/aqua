import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { members } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { payments } from "@/db/schema/payments";
import { invoices } from "@/db/schema/invoices";
import { subscriptions } from "@/db/schema/subscriptions";
import { membershipPlans } from "@/db/schema/membership-plans";
import { dayRangeUtc } from "@/lib/time/tz";
import type { ReportPeriod } from "@/lib/services/owner-reports";
import type { ActionCtx } from "@/lib/auth/context";

// U-01 — owner analytics reads for /owner/reports. Four series,
// all computed from existing tables (no new schema):
//   * attendance trend  — present+late over total marks per day
//   * collections       — captured payments per tenant-local day
//   * plan-wise revenue — captured payments joined back to the plan
//   * member mix        — members grouped by lifecycle status
//
// Expenses are deliberately absent: no expense table exists in the
// schema (they are Phase 5, project-scope §5). The collections
// series therefore carries `expensesPaise: null` — the chart shows
// one real series and says so, rather than inventing a second one.
// The "collections vs target" arc is likewise omitted: no target
// exists anywhere in the schema.

export type TrendPoint = { date: string; present: number; total: number; pct: number | null };

export type CollectionsPoint = { date: string; paise: number };

export type PlanRevenueRow = {
  planName: string;
  paise: number;
  paymentCount: number;
};

export type MemberMixSlice = { status: string; count: number };

export type CollectionsSeries = {
  totalPaise: number;
  byDay: CollectionsPoint[];
  // null = not tracked in this release. Never a fabricated zero.
  expensesPaise: number | null;
};

export type MoneyAnalytics = {
  collections: CollectionsSeries;
  planRevenue: PlanRevenueRow[];
};

export type OperationalAnalytics = {
  attendanceTrend: TrendPoint[];
  memberMix: MemberMixSlice[];
};

export async function getOperationalAnalytics(
  ctx: ActionCtx,
  period: ReportPeriod,
): Promise<OperationalAnalytics> {
  return withTenant(ctx.tenantId, async (tx) => {
    const trendRows = await tx
      .select({
        date: sql<string>`${sessions.sessionDate}::text`,
        present: sql<number>`count(*) filter (where ${attendance.status} in ('present', 'late'))::int`,
        total: sql<number>`count(${attendance.id})::int`,
      })
      .from(sessions)
      .leftJoin(
        attendance,
        and(
          eq(attendance.sessionId, sessions.id),
          eq(attendance.tenantId, ctx.tenantId),
        ),
      )
      .where(
        and(
          eq(sessions.tenantId, ctx.tenantId),
          sql`${sessions.status} <> 'cancelled'`,
          gte(sessions.sessionDate, period.from),
          lt(sessions.sessionDate, period.to),
        ),
      )
      .groupBy(sessions.sessionDate)
      .orderBy(sessions.sessionDate);

    const mixRows = await tx
      .select({
        status: members.status,
        count: sql<number>`count(*)::int`,
      })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), isNull(members.deletedAt)))
      .groupBy(members.status);

    return {
      attendanceTrend: trendRows.map((r) => ({
        date: r.date,
        present: Number(r.present),
        total: Number(r.total),
        pct:
          Number(r.total) > 0
            ? Math.round((Number(r.present) / Number(r.total)) * 100)
            : null,
      })),
      memberMix: mixRows.map((r) => ({ status: r.status, count: Number(r.count) })),
    };
  });
}

export async function getMoneyAnalytics(
  ctx: ActionCtx,
  period: ReportPeriod,
): Promise<MoneyAnalytics> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenant?.timezone ?? "UTC";
    // period.to is exclusive (the first day of the next window), so
    // its day-start is this window's end boundary.
    const { fromUtc } = dayRangeUtc(period.from, timezone);
    const { fromUtc: endUtc } = dayRangeUtc(period.to, timezone);

    const paymentWindow = and(
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, fromUtc),
      lt(payments.receivedAt, endUtc),
    );

    const byDayRows = await tx
      .select({
        date: sql<string>`(${payments.receivedAt} at time zone ${timezone})::date::text`,
        paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .where(paymentWindow)
      .groupBy(sql`(${payments.receivedAt} at time zone ${timezone})::date`)
      .orderBy(sql`(${payments.receivedAt} at time zone ${timezone})::date`);

    const planRows = await tx
      .select({
        planName: sql<string>`coalesce(${membershipPlans.name}, 'No plan linked')`,
        paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
        paymentCount: sql<number>`count(*)::int`,
      })
      .from(payments)
      .innerJoin(
        invoices,
        and(eq(invoices.id, payments.invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .leftJoin(
        subscriptions,
        and(
          eq(subscriptions.id, invoices.subscriptionId),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(
        membershipPlans,
        and(
          eq(membershipPlans.id, subscriptions.planId),
          eq(membershipPlans.tenantId, ctx.tenantId),
        ),
      )
      .where(paymentWindow)
      .groupBy(membershipPlans.name)
      .orderBy(sql`coalesce(sum(${payments.amountPaise}), 0) desc`);

    const byDay = byDayRows.map((r) => ({
      date: r.date,
      paise: Number(r.paise),
    }));

    return {
      collections: {
        totalPaise: byDay.reduce((sum, p) => sum + p.paise, 0),
        byDay,
        expensesPaise: null,
      },
      planRevenue: planRows.map((r) => ({
        planName: r.planName,
        paise: Number(r.paise),
        paymentCount: Number(r.paymentCount),
      })),
    };
  });
}
