import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { paymentReversals } from "@/db/schema/payment-reversals";
import { invoices, type InvoiceStatus, type InvoiceSource } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { userLabel, userRoleNameFor, userNameFor } from "@/lib/services/payment-receiver";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import { callerHasPermission } from "@/lib/services/resource-access";
import { dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { toSafePaise } from "@/lib/money/safe-paise";
import {
  PAYMENT_GROUPS,
  PAYMENT_METHODS,
  methodsForGroup,
} from "@/lib/money/payment-groups";
import type { PaymentMethod } from "@/db/schema/payments";

// U-02 — the Fees & Payments hub reads. This is one place over the
// existing C-29…C-39 spine: an overview (collected / outstanding), a
// transaction ledger (captured payments), dues (invoices with an
// outstanding balance) and the full invoice list. Plans are read
// through the existing C-29 service; discounts are Phase 5 and have
// no surface here.
//
// All reads are location-scoped through the standard O-08 predicate.

export type FeesOverview = {
  from: string | null;
  to: string | null;
  collectedPaise: number;
  paymentCount: number;
  reversedPaise: number;
  reversalCount: number;
  outstandingPaise: number;
  dueInvoiceCount: number;
  overduePaise: number;
  overdueInvoiceCount: number;
  /** Past-due balance by age, in whole days late (IST due dates). */
  overdueAgeing: { bucket: "1-7" | "8-30" | "31+"; paise: number; count: number }[];
  today: string;
};

export type HubInvoiceRow = {
  id: string;
  invoiceNumber: string;
  memberId: string;
  memberName: string;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: InvoiceStatus;
  source: InvoiceSource;
  issuedOn: string;
  dueOn: string;
  locationName: string;
};

export type HubTransactionRow = {
  id: string;
  receivedAt: string;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  invoiceNumber: string | null;
  memberId: string | null;
  memberName: string | null;
  locationName: string;
  receivedByName: string | null;
  // PR2-C9 — reversals appear as their own negative rows so the
  // ledger nets to collectedPaise.
  kind: "payment" | "reversal";
  reason: string | null;
};

export const feesInvoiceFilterInput = z.object({
  status: z.enum(["dues", "all"]).default("all"),
  locationId: z.string().uuid().optional(),
});

export const feesTransactionsInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationId: z.string().uuid().optional(),
  // Home's payment-mix drill-down: one method, or one of the three owner
  // groups (cash / digital / other). Both narrow the same read the
  // screen totals come from, so the filtered list always reconciles.
  method: z.enum(PAYMENT_METHODS).optional(),
  group: z.enum(PAYMENT_GROUPS).optional(),
});

const DUES_STATUSES: InvoiceStatus[] = ["issued", "partial"];

// M02 (2026-10-09 role/content/permission audit §11) — the reception
// desk's read-only call list: issued/partial invoices with an
// outstanding balance, restricted to the caller's allowed locations,
// overdue first, capped. Deliberately narrower than the owner Fees hub:
// no collected/outstanding/reversal totals, no by-method or by-staff
// split — just who to call and how much.
export type DeskDueRow = {
  id: string;
  invoiceNumber: string;
  memberName: string;
  memberCode: string;
  phone: string | null;
  dueOn: string;
  outstandingPaise: number;
  overdue: boolean;
};

export const DESK_DUES_LIMIT = 50;

export async function listDeskDues(
  ctx: ActionCtx,
  limit = DESK_DUES_LIMIT,
): Promise<DeskDueRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await callerHasPermission(tx, ctx, "invoices.read"))) return [];

    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant?.timezone ?? "UTC");

    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(invoices.tenantId, ctx.tenantId),
      inArray(invoices.status, DUES_STATUSES),
      sql`${invoices.totalPaise} > ${invoices.paidPaise}`,
    ];
    const predicate = locationPredicate(invoices.locationId, access);
    if (predicate) conditions.push(predicate);

    const rows = await tx
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        memberName: persons.fullName,
        memberCode: members.memberCode,
        phone: persons.phone,
        dueOn: invoices.dueOn,
        totalPaise: invoices.totalPaise,
        paidPaise: invoices.paidPaise,
      })
      .from(invoices)
      .innerJoin(
        members,
        and(eq(members.id, invoices.memberId), eq(members.tenantId, ctx.tenantId)),
      )
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(...conditions))
      .orderBy(asc(invoices.dueOn), asc(invoices.createdAt))
      .limit(limit);

    return rows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      memberName: row.memberName,
      memberCode: row.memberCode,
      phone: row.phone,
      dueOn: row.dueOn,
      outstandingPaise: toSafePaise(row.totalPaise - row.paidPaise),
      overdue: row.dueOn < today,
    }));
  });
}

export async function getFeesOverview(
  ctx: ActionCtx,
  period: { from: string; to: string },
  options: { locationId?: string } = {},
): Promise<FeesOverview> {
  const locationId = options.locationId;
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenant?.timezone ?? "UTC";
    const { fromUtc } = dayRangeUtc(period.from, timezone);
    const { fromUtc: endUtc } = dayRangeUtc(period.to, timezone);
    const today = todayInZone(timezone);

    const access = await resolveLocationAccess(tx, ctx);
    const payPredicate = locationPredicate(payments.locationId, access);
    const invPredicate = locationPredicate(invoices.locationId, access);

    const paymentConditions = [
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, fromUtc),
      lt(payments.receivedAt, endUtc),
    ];
    if (locationId) paymentConditions.push(eq(payments.locationId, locationId));
    if (payPredicate) paymentConditions.push(payPredicate);

    const [collected] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${payments.amountPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(and(...paymentConditions));

    const dueConditions = [
      eq(invoices.tenantId, ctx.tenantId),
      inArray(invoices.status, DUES_STATUSES),
      sql`${invoices.totalPaise} > ${invoices.paidPaise}`,
    ];
    if (locationId) dueConditions.push(eq(invoices.locationId, locationId));
    if (invPredicate) dueConditions.push(invPredicate);

    const [outstanding] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(...dueConditions));

    const reversalConditions = [
      eq(paymentReversals.tenantId, ctx.tenantId),
      gte(paymentReversals.createdAt, fromUtc),
      lt(paymentReversals.createdAt, endUtc),
    ];
    if (locationId) {
      reversalConditions.push(
        sql`${paymentReversals.paymentId} in (select id from payments where tenant_id = ${ctx.tenantId} and location_id = ${locationId})`,
      );
    }
    if (payPredicate) {
      reversalConditions.push(
        sql`${paymentReversals.paymentId} in (select id from payments where tenant_id = ${ctx.tenantId} and ${payPredicate})`,
      );
    }
    const [reversed] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${paymentReversals.amountPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(paymentReversals)
      .where(and(...reversalConditions));

    const [overdue] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(...dueConditions, lt(invoices.dueOn, today)));

    // Ageing buckets: the due date is a calendar date, so "days late" is
    // the IST date difference. Invoices due today are not yet late and
    // are excluded (the same lt() gate as the overdue total).
    const ageingBucket = sql<string>`case
        when (${today}::date - ${invoices.dueOn}) between 1 and 7 then '1-7'
        when (${today}::date - ${invoices.dueOn}) between 8 and 30 then '8-30'
        else '31+'
      end`.as("bucket");
    const scopedOverdue = tx
      .select({
        bucket: ageingBucket,
        outstanding: sql`${invoices.totalPaise} - ${invoices.paidPaise}`.as("outstanding"),
      })
      .from(invoices)
      .where(and(...dueConditions, lt(invoices.dueOn, today)))
      .as("scoped_overdue");
    const ageingRows = await tx
      .select({
        bucket: scopedOverdue.bucket,
        paise: sql<string>`coalesce(sum(${scopedOverdue.outstanding}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(scopedOverdue)
      .groupBy(scopedOverdue.bucket);
    const ageing = new Map(ageingRows.map((row) => [row.bucket, row]));
    const overdueAgeing = (["1-7", "8-30", "31+"] as const).map((bucket) => ({
      bucket,
      paise: toSafePaise(ageing.get(bucket)?.paise ?? "0"),
      count: Number(ageing.get(bucket)?.count ?? 0),
    }));

    return {
      from: period.from,
      to: period.to,
      // GROSS captured payments for the period. A reversal is
      // ledger-only and is NEVER netted into this figure — the
      // approved contract says so twice: docs/design-system/screens.md
      // (/owner/fees): "A reversal is stated beside the total and is
      // ledger-only: it is never netted into the collected figure",
      // and docs/design-system/flows.md O1: "it is ledger-only, and it
      // is never netted into the collected total". The reversed total
      // is stated BESIDE it (reversedPaise / reversalCount) and the
      // ledger carries the reversal rows, so the owner sees the
      // correction without the collection figure being rewritten.
      // This matches the owner home chart, the daily collection report
      // and daily_rollups, which are all gross too.
      collectedPaise: toSafePaise(collected?.paise ?? "0"),
      paymentCount: Number(collected?.count ?? 0),
      reversedPaise: toSafePaise(reversed?.paise ?? "0"),
      reversalCount: Number(reversed?.count ?? 0),
      outstandingPaise: toSafePaise(outstanding?.paise ?? "0"),
      dueInvoiceCount: Number(outstanding?.count ?? 0),
      overduePaise: toSafePaise(overdue?.paise ?? "0"),
      overdueInvoiceCount: Number(overdue?.count ?? 0),
      overdueAgeing,
      today,
    };
  });
}

export async function listHubInvoices(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HubInvoiceRow[]> {
  const parsed = feesInvoiceFilterInput.safeParse(raw);
  if (!parsed.success) return [];

  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [eq(invoices.tenantId, ctx.tenantId)];
    if (parsed.data.status === "dues") {
      conditions.push(inArray(invoices.status, DUES_STATUSES));
      conditions.push(sql`${invoices.totalPaise} > ${invoices.paidPaise}`);
    }
    if (parsed.data.locationId) {
      conditions.push(eq(invoices.locationId, parsed.data.locationId));
    }
    const predicate = locationPredicate(invoices.locationId, access);
    if (predicate) conditions.push(predicate);

    const rows = await tx
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        memberId: invoices.memberId,
        memberName: persons.fullName,
        totalPaise: invoices.totalPaise,
        paidPaise: invoices.paidPaise,
        status: invoices.status,
        source: invoices.source,
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        locationName: locations.name,
      })
      .from(invoices)
      .innerJoin(
        members,
        and(eq(members.id, invoices.memberId), eq(members.tenantId, ctx.tenantId)),
      )
      .innerJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, invoices.locationId))
      .where(and(...conditions))
      .orderBy(
        parsed.data.status === "dues" ? asc(invoices.dueOn) : desc(invoices.issuedOn),
        desc(invoices.createdAt),
      );

    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      memberId: r.memberId,
      memberName: r.memberName,
      totalPaise: toSafePaise(r.totalPaise),
      paidPaise: toSafePaise(r.paidPaise),
      outstandingPaise: toSafePaise(r.totalPaise - r.paidPaise),
      status: r.status as InvoiceStatus,
      source: r.source as InvoiceSource,
      issuedOn: r.issuedOn,
      dueOn: r.dueOn,
      locationName: r.locationName,
    }));
  });
}

export const HUB_TRANSACTION_LIMIT = 200;

export type HubTransactionPage = {
  rows: HubTransactionRow[];
  /** Every row the filter matches — not only the page shown. */
  totalCount: number;
  /** True when `rows` is a prefix of the matching rows. */
  truncated: boolean;
  limit: number;
};

/**
 * The transaction ledger page.
 *
 * The rows are the newest matching entries; the count is the number
 * of entries the filter matches IN FULL, so a screen that shows the
 * first N can say so honestly instead of implying the list is
 * exhaustive (the overview's collected figure covers every payment in
 * the period, so a silent truncation made the two disagree).
 */
export async function listHubTransactionsPage(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HubTransactionPage> {
  const parsed = feesTransactionsInput.safeParse(raw);
  if (!parsed.success) {
    return { rows: [], totalCount: 0, truncated: false, limit: HUB_TRANSACTION_LIMIT };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenant?.timezone ?? "UTC";
    const { fromUtc } = dayRangeUtc(parsed.data.from, timezone);
    const { fromUtc: endUtc } = dayRangeUtc(parsed.data.to, timezone);

    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(payments.tenantId, ctx.tenantId),
      eq(payments.status, "captured"),
      gte(payments.receivedAt, fromUtc),
      lt(payments.receivedAt, endUtc),
    ];
    if (parsed.data.locationId) {
      conditions.push(eq(payments.locationId, parsed.data.locationId));
    }
    const predicate = locationPredicate(payments.locationId, access);
    if (predicate) conditions.push(predicate);
    if (parsed.data.method) conditions.push(eq(payments.method, parsed.data.method));
    if (parsed.data.group) {
      conditions.push(inArray(payments.method, [...methodsForGroup(parsed.data.group)]));
    }

    const rows = await tx
      .select({
        id: payments.id,
        receivedAt: payments.receivedAt,
        amountPaise: payments.amountPaise,
        method: payments.method,
        reference: payments.reference,
        invoiceNumber: invoices.invoiceNumber,
        memberId: payments.memberId,
        memberName: persons.fullName,
        locationName: locations.name,
        receiverName: userNameFor(payments.tenantId, payments.receivedBy),
        receiverRole: userRoleNameFor(payments.tenantId, payments.receivedBy),
        // The number of payments the filter matches, counted before
        // the limit — so a truncated page can say what it left out.
        matchingCount: sql<number>`count(*) over ()::int`,
      })
      .from(payments)
      .leftJoin(
        invoices,
        and(eq(invoices.id, payments.invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .leftJoin(
        members,
        and(eq(members.id, payments.memberId), eq(members.tenantId, ctx.tenantId)),
      )
      .leftJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, payments.locationId))
      .where(and(...conditions))
      .orderBy(desc(payments.receivedAt))
      .limit(HUB_TRANSACTION_LIMIT);

    // PR2-C9 — reversal rows, joined back to the payment for location
    // scoping and display context. Negative amount so the list nets.
    const reversalConditions = [
      eq(paymentReversals.tenantId, ctx.tenantId),
      gte(paymentReversals.createdAt, fromUtc),
      lt(paymentReversals.createdAt, endUtc),
    ];
    if (parsed.data.locationId) {
      reversalConditions.push(eq(payments.locationId, parsed.data.locationId));
    }
    if (predicate) reversalConditions.push(predicate);
    if (parsed.data.method) reversalConditions.push(eq(payments.method, parsed.data.method));
    if (parsed.data.group) {
      reversalConditions.push(
        inArray(payments.method, [...methodsForGroup(parsed.data.group)]),
      );
    }
    const reversalRows = await tx
      .select({
        id: paymentReversals.id,
        reversedAt: paymentReversals.createdAt,
        amountPaise: paymentReversals.amountPaise,
        reason: paymentReversals.reason,
        method: payments.method,
        invoiceNumber: invoices.invoiceNumber,
        memberId: payments.memberId,
        memberName: persons.fullName,
        locationName: locations.name,
        receiverName: userNameFor(paymentReversals.tenantId, paymentReversals.reversedBy),
        receiverRole: userRoleNameFor(paymentReversals.tenantId, paymentReversals.reversedBy),
        // The number of reversals the filter matches, counted before
        // the limit — the other half of the honest total.
        matchingCount: sql<number>`count(*) over ()::int`,
      })
      .from(paymentReversals)
      .innerJoin(
        payments,
        and(
          eq(payments.id, paymentReversals.paymentId),
          eq(payments.tenantId, paymentReversals.tenantId),
        ),
      )
      .leftJoin(
        invoices,
        and(eq(invoices.id, payments.invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .leftJoin(
        members,
        and(eq(members.id, payments.memberId), eq(members.tenantId, ctx.tenantId)),
      )
      .leftJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, payments.locationId))
      .where(and(...reversalConditions))
      .orderBy(desc(paymentReversals.createdAt))
      .limit(HUB_TRANSACTION_LIMIT);

    const combined: HubTransactionRow[] = [
      ...rows.map((r) => ({
        id: r.id,
        receivedAt: r.receivedAt.toISOString(),
        amountPaise: toSafePaise(r.amountPaise),
        method: r.method as PaymentMethod,
        reference: r.reference,
        invoiceNumber: r.invoiceNumber,
        memberId: r.memberId,
        memberName: r.memberName,
        locationName: r.locationName,
        receivedByName: userLabel(r.receiverName, r.receiverRole),
        kind: "payment" as const,
        reason: null,
      })),
      ...reversalRows.map((r) => ({
        id: r.id,
        receivedAt: r.reversedAt.toISOString(),
        amountPaise: -toSafePaise(r.amountPaise),
        method: r.method as PaymentMethod,
        reference: null,
        invoiceNumber: r.invoiceNumber,
        memberId: r.memberId,
        memberName: r.memberName,
        locationName: r.locationName,
        receivedByName: userLabel(r.receiverName, r.receiverRole),
        kind: "reversal" as const,
        reason: r.reason,
      })),
    ].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));

    const page = combined.slice(0, HUB_TRANSACTION_LIMIT);
    const totalCount =
      Number(rows[0]?.matchingCount ?? 0) +
      Number(reversalRows[0]?.matchingCount ?? 0);
    return {
      rows: page,
      totalCount,
      truncated: totalCount > page.length,
      limit: HUB_TRANSACTION_LIMIT,
    };
  });
}

/**
 * The ledger rows alone. The same read as listHubTransactionsPage,
 * without the count — for callers that only need the rows.
 */
export async function listHubTransactions(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HubTransactionRow[]> {
  return (await listHubTransactionsPage(ctx, raw)).rows;
}
