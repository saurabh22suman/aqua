import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { guardianships } from "@/db/schema/consent";
import {
  guardianChildLinks,
  memberAccountLinks,
} from "@/db/schema/member-self";
import type { SelfScope } from "@/lib/auth/self-scope";
import { isMinor } from "@/lib/time/tz";
import { tenantTimezoneInTx } from "@/lib/services/tenant-timezone";
import type { MemberId, PersonId, UserId } from "@/lib/ids";

export type ShowcaseSubject = {
  memberId: MemberId;
  subjectPersonId: PersonId;
  dateOfBirth: string | null;
  isMinor: boolean | null;
  deciderRole: "subject" | "guardian";
  deciderPersonId: PersonId;
  deciderUserId: UserId;
  sourceLinkId: string;
};

export async function showcaseTimeZone(
  tx: TenantTx,
  tenantId: string,
): Promise<string> {
  return tenantTimezoneInTx(tx, tenantId);
}

function minorStatus(dateOfBirth: string | null, timeZone: string): boolean | null {
  if (dateOfBirth === null) return null;
  return isMinor(dateOfBirth, timeZone);
}

async function resolveMemberSubject(
  tx: TenantTx,
  scope: SelfScope,
  memberId: MemberId,
  timeZone: string,
): Promise<ShowcaseSubject | null> {
  const rows = await tx
    .select({
      memberId: members.id,
      personId: persons.id,
      dateOfBirth: persons.dateOfBirth,
      sourceLinkId: memberAccountLinks.id,
    })
    .from(members)
    .innerJoin(
      persons,
      and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, members.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .innerJoin(
      memberAccountLinks,
      and(
        eq(memberAccountLinks.tenantId, scope.tenantId),
        eq(memberAccountLinks.userId, scope.userId),
        eq(memberAccountLinks.memberId, memberId),
        eq(memberAccountLinks.status, "active"),
        isNull(memberAccountLinks.revokedAt),
        inArray(memberAccountLinks.id, scope.linkIds),
      ),
    )
    .where(
      and(
        eq(members.id, memberId),
        eq(members.tenantId, scope.tenantId),
        isNull(members.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    memberId: row.memberId,
    subjectPersonId: row.personId,
    dateOfBirth: row.dateOfBirth,
    isMinor: minorStatus(row.dateOfBirth, timeZone),
    deciderRole: "subject",
    deciderPersonId: row.personId,
    deciderUserId: scope.userId,
    sourceLinkId: row.sourceLinkId,
  };
}

async function resolveGuardianSubject(
  tx: TenantTx,
  scope: SelfScope,
  memberId: MemberId,
  timeZone: string,
): Promise<ShowcaseSubject | null> {
  const rows = await tx
    .select({
      memberId: members.id,
      childPersonId: members.personId,
      minorId: guardianships.minorId,
      guardianPersonId: guardianships.guardianId,
      dateOfBirth: persons.dateOfBirth,
      sourceLinkId: guardianChildLinks.id,
    })
    .from(guardianChildLinks)
    .innerJoin(
      members,
      and(
        eq(members.id, guardianChildLinks.memberId),
        eq(members.tenantId, guardianChildLinks.tenantId),
        isNull(members.deletedAt),
      ),
    )
    .innerJoin(
      persons,
      and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, guardianChildLinks.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .innerJoin(
      guardianships,
      and(
        eq(guardianships.id, guardianChildLinks.guardianshipId),
        eq(guardianships.tenantId, guardianChildLinks.tenantId),
        isNull(guardianships.deletedAt),
      ),
    )
    .where(
      and(
        eq(guardianChildLinks.tenantId, scope.tenantId),
        eq(guardianChildLinks.userId, scope.userId),
        eq(guardianChildLinks.memberId, memberId),
        eq(guardianChildLinks.status, "active"),
        isNull(guardianChildLinks.revokedAt),
        inArray(guardianChildLinks.id, scope.linkIds),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.childPersonId !== row.minorId) return null;

  const guardianRows = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(
      and(
        eq(persons.id, row.guardianPersonId),
        eq(persons.tenantId, scope.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .limit(1);
  if (!guardianRows[0]) return null;

  return {
    memberId: row.memberId,
    subjectPersonId: row.childPersonId,
    dateOfBirth: row.dateOfBirth,
    isMinor: minorStatus(row.dateOfBirth, timeZone),
    deciderRole: "guardian",
    deciderPersonId: row.guardianPersonId,
    deciderUserId: scope.userId,
    sourceLinkId: row.sourceLinkId,
  };
}

export async function resolveShowcaseSubject(
  tx: TenantTx,
  scope: SelfScope,
  memberId: MemberId,
  timeZone: string,
): Promise<ShowcaseSubject | null> {
  if (scope.audience === "member") {
    if (!scope.memberId || scope.memberId !== memberId) return null;
    return resolveMemberSubject(tx, scope, memberId, timeZone);
  }
  return resolveGuardianSubject(tx, scope, memberId, timeZone);
}

export async function listGuardianSubjects(
  tx: TenantTx,
  scope: SelfScope,
  timeZone: string,
): Promise<ShowcaseSubject[]> {
  if (scope.audience !== "guardian") return [];
  const out: ShowcaseSubject[] = [];
  for (const memberId of scope.childMemberIds) {
    const subject = await resolveGuardianSubject(tx, scope, memberId, timeZone);
    if (subject) out.push(subject);
  }
  return out;
}
