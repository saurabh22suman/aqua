import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { members, persons, type MemberStatus } from "@/db/schema/people";
import { guardianships, consents } from "@/db/schema/consent";
import { locations } from "@/db/schema/locations";
import { tenants } from "@/db/schema/tenants";
import { memberStatusTransitions } from "@/db/schema/people";
import type { Ctx } from "@/lib/auth/context";
import { isMinor } from "@/lib/time/tz";

type ActionCtx = Pick<Ctx, "tenantId"> & { userId?: string };

// isMinor() deliberately throws on a null date of birth -- correct at
// registration, where createMemberSchema makes it mandatory (C-05).
// Wrong here: these are READ paths over rows that can predate that
// requirement (found via manual testing against the seeded demo
// tenant, whose earliest members were created before C-05 landed).
// Unknown DOB reads as "not flagged a minor" rather than crashing the
// whole list over one row -- the honest state is "we don't know",
// displayed as a blank date of birth, not a guess either way.
function isMinorSafe(dateOfBirth: string | null, timeZone: string): boolean {
  return dateOfBirth ? isMinor(dateOfBirth, timeZone) : false;
}

export type MemberListRow = {
  memberId: string;
  personId: string;
  fullName: string;
  phone: string | null;
  memberCode: string;
  status: MemberStatus;
  locationId: string;
  locationName: string;
  isMinor: boolean;
};

// C-06 done-when covers "list with search and filters" -- search is a
// substring match on name or phone; filters are status and location.
// deletedAt is null on both sides (a member row and its person row can
// only be soft-deleted together, but there's no cross-table guarantee
// of that yet, so both are checked).
export async function listMembers(
  ctx: ActionCtx,
  filters: { search?: string; status?: MemberStatus; locationId?: string } = {},
): Promise<MemberListRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const conditions = [
      eq(members.tenantId, ctx.tenantId),
      isNull(members.deletedAt),
      isNull(persons.deletedAt),
    ];
    if (filters.status) conditions.push(eq(members.status, filters.status));
    if (filters.locationId) conditions.push(eq(members.locationId, filters.locationId));
    if (filters.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      conditions.push(or(ilike(persons.fullName, term), ilike(persons.phone, term))!);
    }

    const rows = await tx
      .select({
        memberId: members.id,
        personId: persons.id,
        fullName: persons.fullName,
        phone: persons.phone,
        dateOfBirth: persons.dateOfBirth,
        memberCode: members.memberCode,
        status: members.status,
        locationId: members.locationId,
        locationName: locations.name,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, members.locationId))
      .where(and(...conditions))
      .orderBy(persons.fullName);

    return rows.map((r) => ({
      memberId: r.memberId,
      personId: r.personId,
      fullName: r.fullName,
      phone: r.phone,
      memberCode: r.memberCode,
      status: r.status as MemberStatus,
      locationId: r.locationId,
      locationName: r.locationName,
      isMinor: isMinorSafe(r.dateOfBirth, tenant.timezone),
    }));
  });
}

export type GuardianRow = {
  personId: string;
  fullName: string;
  phone: string | null;
  relationship: string;
  isPrimary: boolean;
};

export type ConsentRow = {
  purpose: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
  granterName: string;
};

export type MemberDetail = {
  memberId: string;
  personId: string;
  fullName: string;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  medicalNotes: string | null;
  memberCode: string;
  status: MemberStatus;
  locationId: string;
  locationName: string;
  isMinor: boolean;
  guardians: GuardianRow[];
  consents: ConsentRow[];
  statusHistory: Array<{
    fromStatus: string;
    toStatus: string;
    reason: string | null;
    changedAt: Date;
  }>;
};

export async function getMemberDetail(
  ctx: ActionCtx,
  memberId: string,
): Promise<MemberDetail | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const [row] = await tx
      .select({
        memberId: members.id,
        personId: persons.id,
        fullName: persons.fullName,
        phone: persons.phone,
        dateOfBirth: persons.dateOfBirth,
        gender: persons.gender,
        medicalNotes: persons.medicalNotes,
        memberCode: members.memberCode,
        status: members.status,
        locationId: members.locationId,
        locationName: locations.name,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .innerJoin(locations, eq(locations.id, members.locationId))
      .where(and(eq(members.id, memberId), eq(members.tenantId, ctx.tenantId)));
    if (!row) return null;

    const guardianRows = await tx
      .select({
        personId: persons.id,
        fullName: persons.fullName,
        phone: persons.phone,
        relationship: guardianships.relationship,
        isPrimary: guardianships.isPrimary,
      })
      .from(guardianships)
      .innerJoin(persons, eq(persons.id, guardianships.guardianId))
      .where(
        and(
          eq(guardianships.tenantId, ctx.tenantId),
          eq(guardianships.minorId, row.personId),
          isNull(guardianships.deletedAt),
        ),
      );

    const consentRows = await tx
      .select({
        purpose: consents.purpose,
        grantedAt: consents.grantedAt,
        withdrawnAt: consents.withdrawnAt,
        evidence: consents.evidence,
      })
      .from(consents)
      .where(and(eq(consents.tenantId, ctx.tenantId), eq(consents.personId, row.personId)))
      .orderBy(desc(consents.grantedAt));

    const history = await tx
      .select({
        fromStatus: memberStatusTransitions.fromStatus,
        toStatus: memberStatusTransitions.toStatus,
        reason: memberStatusTransitions.reason,
        changedAt: memberStatusTransitions.changedAt,
      })
      .from(memberStatusTransitions)
      .where(
        and(
          eq(memberStatusTransitions.tenantId, ctx.tenantId),
          eq(memberStatusTransitions.memberId, memberId),
        ),
      )
      .orderBy(desc(memberStatusTransitions.changedAt));

    return {
      memberId: row.memberId,
      personId: row.personId,
      fullName: row.fullName,
      phone: row.phone,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      medicalNotes: row.medicalNotes,
      memberCode: row.memberCode,
      status: row.status as MemberStatus,
      locationId: row.locationId,
      locationName: row.locationName,
      isMinor: isMinorSafe(row.dateOfBirth, tenant.timezone),
      guardians: guardianRows,
      consents: consentRows.map((c) => ({
        purpose: c.purpose,
        grantedAt: c.grantedAt,
        withdrawnAt: c.withdrawnAt,
        granterName: (c.evidence as { granterName?: string }).granterName ?? "",
      })),
      statusHistory: history,
    };
  });
}

export async function updateMember(
  ctx: ActionCtx,
  memberId: string,
  input: {
    fullName: string;
    phone?: string;
    dateOfBirth: string;
    gender?: string;
    medicalNotes?: string;
    locationId: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [member] = await tx
      .select({ personId: members.personId })
      .from(members)
      .where(and(eq(members.id, memberId), eq(members.tenantId, ctx.tenantId)));
    if (!member) return { ok: false, error: "Member not found." };

    await tx
      .update(persons)
      .set({
        fullName: input.fullName,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        medicalNotes: input.medicalNotes,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(persons.id, member.personId));

    await tx
      .update(members)
      .set({ locationId: input.locationId, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(members.id, memberId));

    return { ok: true };
  });
}

export type PersonSearchRow = {
  personId: string;
  fullName: string;
  phone: string | null;
  isMinor: boolean;
};

// Guardian resolution (C-06): search existing persons to link as a
// guardian rather than creating a duplicate. Minors are excluded --
// a minor cannot be someone else's guardian.
export async function searchPersons(
  ctx: ActionCtx,
  query: string,
): Promise<PersonSearchRow[]> {
  if (!query.trim()) return [];
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const term = `%${query.trim()}%`;
    const rows = await tx
      .select({
        personId: persons.id,
        fullName: persons.fullName,
        phone: persons.phone,
        dateOfBirth: persons.dateOfBirth,
      })
      .from(persons)
      .where(
        and(
          eq(persons.tenantId, ctx.tenantId),
          isNull(persons.deletedAt),
          or(ilike(persons.fullName, term), ilike(persons.phone, term))!,
        ),
      )
      .orderBy(persons.fullName)
      .limit(10);

    return rows
      .map((r) => ({
        personId: r.personId,
        fullName: r.fullName,
        phone: r.phone,
        isMinor: isMinorSafe(r.dateOfBirth, tenant.timezone),
      }))
      .filter((r) => !r.isMinor);
  });
}

export type LocationOption = { id: string; name: string };

export async function listLocations(ctx: ActionCtx): Promise<LocationOption[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.tenantId, ctx.tenantId), isNull(locations.deletedAt)))
      .orderBy(locations.name),
  );
}

// Per-tenant member code generator (C-03 done-when: "codes are unique
// per tenant and never reused"). A running counter would be reused
// after a delete; this reads the current max suffix and adds one. Two
// concurrent registrations CAN compute the same next code -- this read
// and createMember's insert are two different transactions, not one,
// so there is no lock spanning both. members_tenant_member_code_key
// is the real guarantee; createMemberAction (lib/actions/people.ts)
// catches that specific conflict and retries with a freshly generated
// code rather than trusting this function to be collision-free alone.
export async function nextMemberCode(ctx: ActionCtx, prefix = "MEM"): Promise<string> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [{ n }] = await tx
      .select({
        n: sql<number>`coalesce(max(substring(${members.memberCode} from '[0-9]+$')::int), 0)`,
      })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), ilike(members.memberCode, `${prefix}-%`)));
    return `${prefix}-${String(n + 1).padStart(4, "0")}`;
  });
}
