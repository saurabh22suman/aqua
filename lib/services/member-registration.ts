import { and, eq } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { members, persons, type MemberStatus } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import type { ActionCtx } from "@/lib/auth/context";
import { isMinor, todayInZone } from "@/lib/time/tz";
import { createGuardianship, recordConsent, type ConsentGrantInput } from "./consent";
import { locationVisible, resolveLocationAccess } from "./location-access";
import { asPersonId, type MemberId, type PersonId, type UserId } from "@/lib/ids";
import { writeAudit } from "@/lib/audit/write";

export type GuardianInput =
  | { existingPersonId: string; relationship: string }
  | { fullName: string; phone?: string; relationship: string };

type CreateMemberInput = {
  fullName: string; phone?: string; dateOfBirth: string; gender?: string;
  locationId: string; memberCode: string; medicalNotes?: string;
  guardian?: GuardianInput; consents: ConsentGrantInput[];
  witnessedByUserId?: UserId; joinedOn?: string; initialStatus?: MemberStatus;
};

export async function createMember(ctx: ActionCtx, input: CreateMemberInput) {
  return withTenant(ctx.tenantId, tx => createMemberInTx(tx, ctx, input));
}

// Shared with CSV import: validation precedes inserts and every failure after
// the first insert throws, so the member/guardian/consent/audit writes roll back.
export async function createMemberInTx(tx: TenantTx, ctx: ActionCtx, input: CreateMemberInput): Promise<
  { ok: true; memberId: MemberId; personId: PersonId } | { ok: false; error: string }
> {
  const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!tenant) return { ok: false, error: "Tenant not found." };
  if (!locationVisible(await resolveLocationAccess(tx, ctx), input.locationId)) {
    return { ok: false, error: "That location is not available to you." };
  }
  const minor = isMinor(input.dateOfBirth, tenant.timezone);
  if (!input.consents.some(c => c.purpose === "processing")) {
    return { ok: false, error: "Processing consent is required to register a member." };
  }
  if (minor && !input.guardian) return { ok: false, error: "A guardian is required to register a minor." };
  const [subject] = await tx.insert(persons).values({
    tenantId: ctx.tenantId, fullName: input.fullName, phone: input.phone,
    dateOfBirth: input.dateOfBirth, gender: input.gender, medicalNotes: input.medicalNotes,
    createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning({ id: persons.id });
  let granterId = subject.id;
  let granterName = input.fullName;
  let granterRelationship = "self";
  if (minor && input.guardian) {
    if ("existingPersonId" in input.guardian) {
      const [existing] = await tx.select({ id: persons.id, fullName: persons.fullName }).from(persons)
        .where(and(eq(persons.id, asPersonId(input.guardian.existingPersonId)), eq(persons.tenantId, ctx.tenantId)));
      if (!existing) throw new Error("createMember: guardian not found in this tenant");
      granterId = existing.id;
      granterName = existing.fullName;
    } else {
      const [guardian] = await tx.insert(persons).values({ tenantId: ctx.tenantId,
        fullName: input.guardian.fullName, phone: input.guardian.phone, createdBy: ctx.userId, updatedBy: ctx.userId,
      }).returning({ id: persons.id });
      granterId = guardian.id;
      granterName = input.guardian.fullName;
    }
    granterRelationship = input.guardian.relationship;
    await createGuardianship(tx, { tenantId: ctx.tenantId, minorId: subject.id, guardianId: granterId,
      relationship: input.guardian.relationship, isPrimary: true, createdBy: ctx.userId });
  }
  for (const grant of input.consents) await recordConsent(tx, { tenantId: ctx.tenantId, personId: subject.id,
    grantedBy: granterId, witnessedByUserId: input.witnessedByUserId ?? ctx.userId, granterName, granterRelationship, grant });
  const [member] = await tx.insert(members).values({ tenantId: ctx.tenantId, personId: subject.id,
    locationId: input.locationId, memberCode: input.memberCode, status: input.initialStatus,
    joinedOn: input.joinedOn ?? todayInZone(tenant.timezone), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning({ id: members.id });
  await writeAudit(tx, { tenantId: ctx.tenantId, actorId: ctx.userId, actorType: ctx.userId ? "user" : "system",
    requestId: ctx.requestId, action: "member.create", entityType: "member", entityId: member.id,
    after: { personId: subject.id, locationId: input.locationId, memberCode: input.memberCode } });
  return { ok: true, memberId: member.id, personId: subject.id };
}
