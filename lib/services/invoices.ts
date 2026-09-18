import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { invoices, invoiceLineItems } from "@/db/schema/invoices";
import { subscriptions } from "@/db/schema/subscriptions";
import { members, persons } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { facilities } from "@/db/schema/preset-engine";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { gstDocumentKind, splitIntraStateTax } from "@/lib/gst";
import { asMemberId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";
import type { InvoiceStatus, InvoiceSource } from "@/db/schema/invoices";

// C-32 — invoice reads. Location-scoped (O-08): a scoped receptionist
// sees only their own facility's documents. The write paths live in
// invoice-mutations.ts (ctx-facing) and invoice-issue.ts (the shared
// in-transaction core).

export type { InvoiceStatus };

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  financialYear: string;
  documentKind: "tax_invoice" | "bill_of_supply";
  issuedOn: string;
  dueOn: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  status: InvoiceStatus;
  source: InvoiceSource;
  gstin: string | null;
  locationId: string;
  locationName: string;
  subscriptionId: string | null;
  activityName: string | null;
  createdAt: string;
};

export type InvoiceLineRow = {
  id: string;
  description: string;
  sacCode: string;
  amountPaise: number;
  taxRateBp: number;
  taxPaise: number;
  // The intra-state split (one tenant = one GSTIN). Equal halves with
  // any odd paise on the SGST side, so cgst + sgst == tax exactly.
  cgstPaise: number;
  sgstPaise: number;
};

export type InvoiceDetail = InvoiceRow & {
  memberId: string;
  memberName: string;
  lines: InvoiceLineRow[];
};

type InvoiceJoinRow = {
  invoice: typeof invoices.$inferSelect;
  locationName: string;
  activityName: string | null;
};

function toRow(row: InvoiceJoinRow): InvoiceRow {
  const inv = row.invoice;
  const total = Number(inv.totalPaise);
  const paid = Number(inv.paidPaise);
  return {
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    financialYear: inv.financialYear,
    documentKind: gstDocumentKind(inv.gstin),
    issuedOn: inv.issuedOn,
    dueOn: inv.dueOn,
    subtotalPaise: Number(inv.subtotalPaise),
    taxPaise: Number(inv.taxPaise),
    totalPaise: total,
    paidPaise: paid,
    outstandingPaise: total - paid,
    status: inv.status as InvoiceStatus,
    source: inv.source as InvoiceSource,
    gstin: inv.gstin,
    locationId: inv.locationId,
    locationName: row.locationName,
    subscriptionId: inv.subscriptionId,
    activityName: row.activityName,
    createdAt: inv.createdAt.toISOString(),
  };
}

export async function listMemberInvoices(
  ctx: ActionCtx,
  memberId: string,
): Promise<InvoiceRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(invoices.tenantId, ctx.tenantId),
      eq(invoices.memberId, asMemberId(memberId)),
    ];
    const predicate = locationPredicate(invoices.locationId, access);
    if (predicate) conditions.push(predicate);

    const rows = await tx
      .select({
        invoice: invoices,
        locationName: locations.name,
        activityName: facilities.name,
      })
      .from(invoices)
      .innerJoin(locations, eq(locations.id, invoices.locationId))
      .leftJoin(
        subscriptions,
        and(
          eq(subscriptions.id, invoices.subscriptionId),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, subscriptions.activityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(invoices.issuedOn), desc(invoices.createdAt));

    return rows.map(toRow);
  });
}

export async function getInvoice(
  ctx: ActionCtx,
  invoiceId: string,
): Promise<InvoiceDetail | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    const rows = await tx
      .select({
        invoice: invoices,
        locationName: locations.name,
        memberName: persons.fullName,
      })
      .from(invoices)
      .innerJoin(locations, eq(locations.id, invoices.locationId))
      .innerJoin(
        members,
        and(
          eq(members.id, invoices.memberId),
          eq(members.tenantId, ctx.tenantId),
        ),
      )
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(
        and(eq(invoices.id, invoiceId), eq(invoices.tenantId, ctx.tenantId)),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (!locationVisible(access, row.invoice.locationId)) return null;

    const lineRows = await tx
      .select()
      .from(invoiceLineItems)
      .where(
        and(
          eq(invoiceLineItems.invoiceId, invoiceId),
          eq(invoiceLineItems.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(asc(invoiceLineItems.createdAt));

    const base = toRow({
      invoice: row.invoice,
      locationName: row.locationName,
      activityName: null,
    });
    return {
      ...base,
      memberId: row.invoice.memberId,
      memberName: row.memberName,
      lines: lineRows.map((line) => {
        const tax = Number(line.taxPaise);
        const split = splitIntraStateTax(tax);
        return {
          id: line.id,
          description: line.description,
          sacCode: line.sacCode,
          amountPaise: Number(line.amountPaise),
          taxRateBp: line.taxRateBp,
          taxPaise: tax,
          cgstPaise: split.cgstPaise,
          sgstPaise: split.sgstPaise,
        };
      }),
    };
  });
}
