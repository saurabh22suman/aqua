import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { guardianships, consents } from "@/db/schema/consent";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId, asPersonId, type TenantId } from "@/lib/ids";
import { normaliseToE164 } from "@/lib/phone";
import { resolveLocationAccess, locationVisible } from "./location-access";
import { writeAudit } from "@/lib/audit/write";
import { isMinor } from "@/lib/time/tz";

export type NotificationContact = { personId: string; name: string; phone: string; relationship: string; selected: boolean };

export async function memberNotificationContacts(tx: TenantTx, tenantId: TenantId, memberId: string) {
  const [member] = await tx.select({ id: members.id, personId: members.personId,
    locationId: members.locationId, status: members.status, selected: members.notificationPersonIds,
    name: persons.fullName, phone: persons.phone, dateOfBirth: persons.dateOfBirth })
    .from(members).innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, tenantId)))
    .where(and(eq(members.tenantId, tenantId), eq(members.id, asMemberId(memberId)),
      isNull(members.deletedAt), isNull(persons.deletedAt))).limit(1);
  if (!member) return null;
  const guardians = await tx.select({ personId: persons.id, name: persons.fullName, phone: persons.phone,
    relationship: guardianships.relationship }).from(guardianships)
    .innerJoin(persons, and(eq(persons.id, guardianships.guardianId), eq(persons.tenantId, tenantId)))
    .where(and(eq(guardianships.tenantId, tenantId), eq(guardianships.minorId, member.personId),
      isNull(guardianships.deletedAt), isNull(persons.deletedAt))).orderBy(desc(guardianships.isPrimary));
  const candidates = [{ personId: member.personId, name: member.name, phone: member.phone, relationship: "Student" }, ...guardians];
  const contacts: NotificationContact[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate.phone) continue;
    const phone = normaliseToE164(candidate.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || seen.has(candidate.personId)) continue;
    seen.add(candidate.personId);
    contacts.push({ ...candidate, phone, selected: false });
  }
  const minor = member.dateOfBirth ? isMinor(member.dateOfBirth, "Asia/Kolkata") : true;
  const primary = minor ? contacts.find((contact) => contact.personId !== member.personId) ?? contacts[0] : contacts[0];
  for (const contact of contacts) {
    contact.selected = member.selected === null ? contact.personId === primary?.personId : member.selected.includes(contact.personId);
  }
  const [consent] = await tx.select({ id: consents.id }).from(consents).where(and(
    eq(consents.tenantId, tenantId), eq(consents.personId, member.personId),
    eq(consents.purpose, "communications"), isNull(consents.withdrawnAt))).limit(1);
  return { member, contacts, communicationsAllowed: Boolean(consent),
    minor };
}

export async function getNotificationDestinations(ctx: ActionCtx, memberId: string) {
  return withTenant(ctx.tenantId, async (tx) => {
    const result = await memberNotificationContacts(tx, ctx.tenantId, memberId);
    const access = await resolveLocationAccess(tx, ctx);
    if (!result || !locationVisible(access, result.member.locationId)) return null;
    return { contacts: result.contacts, communicationsAllowed: result.communicationsAllowed, minor: result.minor };
  });
}

export async function saveNotificationDestinations(ctx: ActionCtx, memberId: string, personIds: string[]) {
  if (!ctx.userId) return { ok: false as const, error: "Not authenticated." };
  return withTenant(ctx.tenantId, async (tx) => {
    await tx.select({ id: members.id }).from(members)
      .where(eq(members.id, asMemberId(memberId))).for("update");
    const result = await memberNotificationContacts(tx, ctx.tenantId, memberId);
    const access = await resolveLocationAccess(tx, ctx);
    if (!result || !locationVisible(access, result.member.locationId)) return { ok: false as const, error: "Member not found." };
    const allowed = new Set(result.contacts.map((contact) => contact.personId));
    if (personIds.some((id) => !allowed.has(id))) return { ok: false as const, error: "Choose only linked contacts with a mobile number." };
    const selected = [...new Set(personIds)];
    await tx.update(members).set({ notificationPersonIds: selected.map(asPersonId), updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(members.id, result.member.id));
    await writeAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, action: "member.notification_destinations",
      entityType: "member", entityId: result.member.id, before: { personIds: result.member.selected },
      after: { personIds: selected }, requestId: ctx.requestId });
    return { ok: true as const };
  });
}
