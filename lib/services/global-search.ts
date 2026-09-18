import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { enquiries } from "@/db/schema/enquiries";
import { invoices } from "@/db/schema/invoices";
import type { ActionCtx } from "@/lib/auth/context";
import { surfaceForRole } from "@/lib/auth/surface-access";
import { formatINR } from "@/lib/money/format";
import {
  locationPredicate,
  resolveLocationAccess,
} from "@/lib/services/location-access";

// U-05 — R1 global search. One read-only surface across members,
// enquiries and invoices, no cross-entity index: LIKE over the
// existing columns, capped per kind. Every query is tenant-scoped
// (the JOINs carry tenant_id; RLS is the second line) and
// location-scoped through the same helper every other staff read
// uses (O-08).
//
// The action that calls this gates on `members.read` — the baseline
// staff read permission. Each additional kind is consulted only when
// the caller actually carries that kind's permission, so an
// accountant (members.read + invoices.read, no enquiries.read) gets
// members and payments and never an enquiry row. A coach carries
// none of the three keys and gets nothing at all; that is the
// mechanical meaning of "a coach search never returns another
// coach's roster" — there is no coach-scoped branch here to leak
// through.

export const SEARCH_RESULT_LIMIT_PER_KIND = 5;

export type GlobalSearchKind = "member" | "enquiry" | "payment";

export type GlobalSearchHit = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

export type GlobalSearchCtx = ActionCtx & {
  roleKey: string;
  permissions: ReadonlySet<string>;
};

// Pure and exported so the permission-scoping itself is testable
// without a database: coach → no kinds; accountant → members +
// payments; owner/reception → all three.
export function entitledSearchKinds(
  permissions: ReadonlySet<string>,
): GlobalSearchKind[] {
  const kinds: GlobalSearchKind[] = [];
  if (permissions.has("members.read")) kinds.push("member");
  if (permissions.has("enquiries.read")) kinds.push("enquiry");
  if (permissions.has("invoices.read")) kinds.push("payment");
  return kinds;
}

// Search lives in the owner shell (U-10) and the member-read roles
// always reach it through /owner; the surface resolver keeps the
// deep links correct if a future surface reuses the box (e.g.
// reception) instead of hard-coding /owner.
export function surfaceBasePath(roleKey: string): string {
  return surfaceForRole(roleKey) === "reception" ? "/reception" : "/owner";
}

type SearchRow = {
  id: string;
  title: string;
  subtitle: string;
};

async function searchMembers(
  tx: TenantTx,
  ctx: GlobalSearchCtx,
  term: string,
): Promise<SearchRow[]> {
  const access = await resolveLocationAccess(tx, ctx);
  const conditions = [
    eq(members.tenantId, ctx.tenantId),
    isNull(members.deletedAt),
    isNull(persons.deletedAt),
    or(
      ilike(persons.fullName, term),
      ilike(persons.phone, term),
      ilike(members.memberCode, term),
    )!,
  ];
  const predicate = locationPredicate(members.locationId, access);
  if (predicate) conditions.push(predicate);

  const rows = await tx
    .select({
      id: members.id,
      fullName: persons.fullName,
      memberCode: members.memberCode,
      status: members.status,
    })
    .from(members)
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(...conditions))
    .orderBy(persons.fullName)
    .limit(SEARCH_RESULT_LIMIT_PER_KIND);

  return rows.map((r) => ({
    id: r.id,
    title: r.fullName,
    subtitle: r.memberCode + " · " + r.status,
  }));
}

async function searchEnquiries(
  tx: TenantTx,
  ctx: GlobalSearchCtx,
  term: string,
): Promise<SearchRow[]> {
  const rows = await tx
    .select({
      id: enquiries.id,
      fullName: enquiries.fullName,
      phone: enquiries.phone,
      stage: enquiries.stage,
    })
    .from(enquiries)
    .where(
      and(
        eq(enquiries.tenantId, ctx.tenantId),
        isNull(enquiries.deletedAt),
        or(ilike(enquiries.fullName, term), ilike(enquiries.phone, term))!,
      ),
    )
    .orderBy(desc(enquiries.createdAt))
    .limit(SEARCH_RESULT_LIMIT_PER_KIND);

  return rows.map((r) => ({
    id: r.id,
    title: r.fullName,
    subtitle: r.phone ? r.phone + " · " + r.stage : r.stage,
  }));
}

async function searchPayments(
  tx: TenantTx,
  ctx: GlobalSearchCtx,
  term: string,
): Promise<Array<SearchRow & { memberId: string }>> {
  const access = await resolveLocationAccess(tx, ctx);
  const conditions = [
    eq(invoices.tenantId, ctx.tenantId),
    isNull(members.deletedAt),
    isNull(persons.deletedAt),
    or(
      ilike(invoices.invoiceNumber, term),
      ilike(persons.fullName, term),
      ilike(persons.phone, term),
    )!,
  ];
  const predicate = locationPredicate(invoices.locationId, access);
  if (predicate) conditions.push(predicate);

  const rows = await tx
    .select({
      id: invoices.id,
      memberId: invoices.memberId,
      invoiceNumber: invoices.invoiceNumber,
      totalPaise: invoices.totalPaise,
      memberName: persons.fullName,
    })
    .from(invoices)
    .innerJoin(members, eq(members.id, invoices.memberId))
    .innerJoin(persons, eq(persons.id, members.personId))
    .where(and(...conditions))
    .orderBy(desc(invoices.issuedOn))
    .limit(SEARCH_RESULT_LIMIT_PER_KIND);

  return rows.map((r) => ({
    id: r.id,
    memberId: r.memberId,
    title: `Invoice ${r.invoiceNumber}`,
    subtitle: `${formatINR(Number(r.totalPaise))} · ${r.memberName}`,
  }));
}

export async function globalSearch(
  ctx: GlobalSearchCtx,
  query: string,
): Promise<GlobalSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const term = `%${trimmed}%`;
  const base = surfaceBasePath(ctx.roleKey);

  const kinds = entitledSearchKinds(ctx.permissions);

  return withTenant(ctx.tenantId, async (tx) => {
    const hits: GlobalSearchHit[] = [];

    if (kinds.includes("member")) {
      const memberRows = await searchMembers(tx, ctx, term);
      for (const r of memberRows) {
        hits.push({ kind: "member", id: r.id, title: r.title, subtitle: r.subtitle, href: `${base}/members/${r.id}` });
      }
    }

    if (kinds.includes("enquiry")) {
      const enquiryRows = await searchEnquiries(tx, ctx, term);
      for (const r of enquiryRows) {
        hits.push({ kind: "enquiry", id: r.id, title: r.title, subtitle: r.subtitle, href: `${base}/enquiries/${r.id}` });
      }
    }

    if (kinds.includes("payment")) {
      const paymentRows = await searchPayments(tx, ctx, term);
      for (const r of paymentRows) {
        // A payment has no page of its own in R1; it deep-links to the
        // member's ledger where the invoice rows render (C-32).
        hits.push({
          kind: "payment",
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          href: `${base}/members/${r.memberId}`,
        });
      }
    }

    return hits;
  });
}
