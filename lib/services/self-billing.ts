import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { SelfScope } from "@/lib/auth/self-scope";
import { members, persons } from "@/db/schema/people";
import { guardianships } from "@/db/schema/consent";
import { guardianChildLinks, memberAccountLinks } from "@/db/schema/member-self";
import { invoices } from "@/db/schema/invoices";
import { payments } from "@/db/schema/payments";
import { asMemberId } from "@/lib/ids";
import { toSafePaise } from "@/lib/money/safe-paise";
import { isMinor, todayInZone } from "@/lib/time/tz";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { authorizeBoundLinks } from "@/lib/services/self-service-session";

// Called only inside the scoped resolver's read callback. Recheck and lock
// the actual relationship and child person before exposing any financial data.
export async function billingSubjectInTx(tx: TenantTx, scope: SelfScope, selected?: string): Promise<string | null> {
  const memberId = scope.audience === "member" ? scope.memberId : selected;
  if (!memberId || (scope.audience === "guardian" && !scope.childMemberIds.includes(asMemberId(memberId)))) return null;
  if (scope.kind !== "self_session" || scope.linkIds.length === 0) return null;
  const pairingStillStands = async () => {
    const account = await readSelfServiceAccountInTx(tx, { tenantId: scope.tenantId, userId: scope.userId });
    const result = await authorizeBoundLinks(tx, { tenantId: scope.tenantId, userId: scope.userId, audience: scope.audience, linkIds: [...scope.linkIds], accountPhone: account?.phone ?? null, subjectId: scope.audience === "member" ? memberId : null });
    return result.ok;
  };
  if (scope.audience === "member") {
    const rows = await tx.select({ id: members.id, dob: persons.dateOfBirth }).from(memberAccountLinks)
      .innerJoin(members, and(eq(members.id, memberAccountLinks.memberId), eq(members.tenantId, scope.tenantId), isNull(members.deletedAt)))
      .innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, scope.tenantId), isNull(persons.deletedAt)))
      .where(and(eq(memberAccountLinks.tenantId, scope.tenantId), eq(memberAccountLinks.userId, scope.userId), eq(memberAccountLinks.memberId, asMemberId(memberId)), eq(memberAccountLinks.status, "active"), isNull(memberAccountLinks.revokedAt), inArray(memberAccountLinks.id, [...scope.linkIds])))
      .limit(1).for("share");
    const row = rows[0]; if (!row) return null;
    const zone = await tenantTimezoneInTx(tx, scope.tenantId);
    // A future or missing DOB cannot establish known minority.
    if (row.dob && row.dob <= todayInZone(zone) && isMinor(row.dob, zone)) return null;
    return await pairingStillStands() ? row.id : null;
  }
  const guardianPerson = persons;
  const rows = await tx.select({ id: members.id }).from(guardianChildLinks)
    .innerJoin(guardianships, and(eq(guardianships.id, guardianChildLinks.guardianshipId), eq(guardianships.tenantId, scope.tenantId), isNull(guardianships.deletedAt)))
    .innerJoin(members, and(eq(members.id, guardianChildLinks.memberId), eq(members.tenantId, scope.tenantId), eq(members.personId, guardianships.minorId), isNull(members.deletedAt)))
    .innerJoin(guardianPerson, and(eq(guardianPerson.id, guardianships.guardianId), eq(guardianPerson.tenantId, scope.tenantId), isNull(guardianPerson.deletedAt)))
    .where(and(eq(guardianChildLinks.tenantId, scope.tenantId), eq(guardianChildLinks.userId, scope.userId), eq(guardianChildLinks.memberId, asMemberId(memberId)), eq(guardianChildLinks.status, "active"), isNull(guardianChildLinks.revokedAt), inArray(guardianChildLinks.id, [...scope.linkIds])))
    .limit(1).for("share");
  if (!rows[0]) return null;
  // Separate lock: the child person is not the guardian person in the join.
  const child = await tx.select({ id: persons.id }).from(members).innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, scope.tenantId), isNull(persons.deletedAt)))
    .where(and(eq(members.id, asMemberId(memberId)), eq(members.tenantId, scope.tenantId), isNull(members.deletedAt))).limit(1).for("share");
  return child.length && await pairingStillStands() ? rows[0].id : null;
}

export async function readSelfBilling(tx: TenantTx, scope: SelfScope, selected?: string) {
  const id = await billingSubjectInTx(tx, scope, selected); if (!id) return null;
  const memberId = asMemberId(id);
  // Same visibility and bounds as the existing parent bearer projection.
  const outstanding = await tx.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, dueOn: invoices.dueOn, totalPaise: invoices.totalPaise, paidPaise: invoices.paidPaise, status: invoices.status }).from(invoices)
    .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.memberId, memberId), sql`${invoices.status} in ('issued', 'partial')`, sql`${invoices.totalPaise} > ${invoices.paidPaise}`)).orderBy(asc(invoices.dueOn)).limit(10);
  const recent = await tx.select({ id: payments.id, receivedAt: payments.receivedAt, amountPaise: payments.amountPaise, method: payments.method, invoiceNumber: invoices.invoiceNumber }).from(payments)
    .leftJoin(invoices, and(eq(invoices.id, payments.invoiceId), eq(invoices.tenantId, scope.tenantId), eq(invoices.memberId, memberId)))
    .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.memberId, memberId), eq(payments.status, "captured"))).orderBy(desc(payments.receivedAt)).limit(8);
  return { outstanding: outstanding.map(x => ({ id: x.id, invoiceNumber: x.invoiceNumber, dueOn: x.dueOn, totalPaise: toSafePaise(x.totalPaise), paidPaise: toSafePaise(x.paidPaise), outstandingPaise: toSafePaise(x.totalPaise - x.paidPaise), status: x.status })), payments: recent.map(x => ({ id: x.id, receivedAt: x.receivedAt.toISOString(), amountPaise: toSafePaise(x.amountPaise), method: x.method, invoiceNumber: x.invoiceNumber ?? null })) };
}
