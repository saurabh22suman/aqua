import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { sessions, attendance } from "@/db/schema/scheduling";
import { members } from "@/db/schema/people";
import { payments } from "@/db/schema/payments";
import { invoices } from "@/db/schema/invoices";
import { dailyRollups } from "@/db/schema/daily-rollups";
import { addDays, dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { TenantId } from "@/lib/ids";

// C-47 — reports.rollup. Upserts one daily summary per tenant for the
// day that just ended (the job runs at 03:00 tenant time), so the
// dashboard and reports can read a precomputed row instead of
// re-aggregating. Idempotent by primary key: a re-run recomputes the
// same numbers and writes the same row.
//
// Definitions, fixed here so the number means one thing:
//   sessions_held      sessions on the date that were not cancelled
//   attendance_marked  attendance rows marked against those sessions
//   new_members        members created during the tenant-local day
//   payments_count     captured payments received that day
//   collections_paise  their total, integer paise
//   invoices_issued    non-void invoices issued that day
//   cafe_paise         captured payments that day settled against
//                      invoices with source = 'cafe' (K-06)
//   cafe_orders        distinct such café invoices settled that day —
//                      the same definition as the live daily
//                      collection report (lib/services/reconciliation.ts)
export async function runReportsRollupJob(tenantId: TenantId): Promise<void> {
  const summary = await withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select({ status: tenants.status, timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row || (row.status !== "trial" && row.status !== "active")) {
      return null;
    }

    const onDate = addDays(todayInZone(row.timezone), -1);
    const { fromUtc, toUtc } = dayRangeUtc(onDate, row.timezone);

    const [sessionRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(
        and(
          eq(sessions.tenantId, tenantId),
          eq(sessions.sessionDate, onDate),
          ne(sessions.status, "cancelled"),
        ),
      );

    const [attendanceRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(attendance)
      .innerJoin(
        sessions,
        and(
          eq(sessions.id, attendance.sessionId),
          eq(sessions.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(attendance.tenantId, tenantId),
          eq(sessions.sessionDate, onDate),
        ),
      );

    const [memberRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(
        and(
          eq(members.tenantId, tenantId),
          gte(members.createdAt, fromUtc),
          lt(members.createdAt, toUtc),
        ),
      );

    const [paymentRow] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.status, "captured"),
          gte(payments.receivedAt, fromUtc),
          lt(payments.receivedAt, toUtc),
        ),
      );

    const [invoiceRow] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${invoices.totalPaise}), 0)::text`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.issuedOn, onDate),
          ne(invoices.status, "void"),
        ),
      );

    // K-06 — café payments are the same payment rows, narrowed by the
    // source of the invoice they settle. Counted by distinct invoice
    // so the figure is "orders settled", not "payment rows".
    const [cafeRow] = await tx
      .select({
        count: sql<number>`count(distinct ${payments.invoiceId})::int`,
        total: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
      })
      .from(payments)
      .innerJoin(
        invoices,
        and(
          eq(invoices.id, payments.invoiceId),
          eq(invoices.tenantId, tenantId),
        ),
      )
      .where(
        and(
          eq(payments.tenantId, tenantId),
          eq(payments.status, "captured"),
          eq(invoices.source, "cafe"),
          gte(payments.receivedAt, fromUtc),
          lt(payments.receivedAt, toUtc),
        ),
      );

    const values = {
      sessionsHeld: sessionRow?.count ?? 0,
      attendanceMarked: attendanceRow?.count ?? 0,
      newMembers: memberRow?.count ?? 0,
      paymentsCount: paymentRow?.count ?? 0,
      collectionsPaise: BigInt(paymentRow?.total ?? "0"),
      invoicesIssued: invoiceRow?.count ?? 0,
      invoicesTotalPaise: BigInt(invoiceRow?.total ?? "0"),
      cafePaise: BigInt(cafeRow?.total ?? "0"),
      cafeOrders: cafeRow?.count ?? 0,
    };

    await tx
      .insert(dailyRollups)
      .values({ tenantId, onDate, ...values, computedAt: new Date() })
      .onConflictDoUpdate({
        target: [dailyRollups.tenantId, dailyRollups.onDate],
        set: { ...values, computedAt: new Date() },
      });

    return { onDate, ...values };
  });

  if (summary) {
    console.log(
      `[reports.rollup] tenant ${tenantId} ${summary.onDate}: ` +
        `${summary.sessionsHeld} session(s), ${summary.attendanceMarked} mark(s), ` +
        `${summary.paymentsCount} payment(s), ${summary.collectionsPaise} paise`,
    );
  }
}
