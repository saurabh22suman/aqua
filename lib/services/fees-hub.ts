import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { payments } from "@/db/schema/payments";
import { invoices, type InvoiceStatus, type InvoiceSource } from "@/db/schema/invoices";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { userLabel, userRoleNameFor, userNameFor } from "@/lib/services/payment-receiver";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";
import { dayRangeUtc, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
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
  outstandingPaise: number;
  dueInvoiceCount: number;
  overduePaise: number;
  overdueInvoiceCount: number;
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
};

export const feesInvoiceFilterInput = z.object({
  status: z.enum(["dues", "all"]).default("all"),
});

export const feesTransactionsInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const DUES_STATUSES: InvoiceStatus[] = ["issued", "partial"];

export async function getFeesOverview(
  ctx: ActionCtx,
  period: { from: string; to: string },
): Promise<FeesOverview> {
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
    if (invPredicate) dueConditions.push(invPredicate);

    const [outstanding] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(...dueConditions));

    const [overdue] = await tx
      .select({
        paise: sql<string>`coalesce(sum(${invoices.totalPaise} - ${invoices.paidPaise}), 0)::text`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(and(...dueConditions, lt(invoices.dueOn, today)));

    return {
      from: period.from,
      to: period.to,
      collectedPaise: Number(collected?.paise ?? "0"),
      paymentCount: Number(collected?.count ?? 0),
      outstandingPaise: Number(outstanding?.paise ?? "0"),
      dueInvoiceCount: Number(outstanding?.count ?? 0),
      overduePaise: Number(overdue?.paise ?? "0"),
      overdueInvoiceCount: Number(overdue?.count ?? 0),
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
      totalPaise: Number(r.totalPaise),
      paidPaise: Number(r.paidPaise),
      outstandingPaise: Number(r.totalPaise) - Number(r.paidPaise),
      status: r.status as InvoiceStatus,
      source: r.source as InvoiceSource,
      issuedOn: r.issuedOn,
      dueOn: r.dueOn,
      locationName: r.locationName,
    }));
  });
}

export async function listHubTransactions(
  ctx: ActionCtx,
  raw: unknown,
): Promise<HubTransactionRow[]> {
  const parsed = feesTransactionsInput.safeParse(raw);
  if (!parsed.success) return [];

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
    const predicate = locationPredicate(payments.locationId, access);
    if (predicate) conditions.push(predicate);

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
      .limit(200);

    return rows.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt.toISOString(),
      amountPaise: Number(r.amountPaise),
      method: r.method as PaymentMethod,
      reference: r.reference,
      invoiceNumber: r.invoiceNumber,
      memberId: r.memberId,
      memberName: r.memberName,
      locationName: r.locationName,
      receivedByName: userLabel(r.receiverName, r.receiverRole),
    }));
  });
}
