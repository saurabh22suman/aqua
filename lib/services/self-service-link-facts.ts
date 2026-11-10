// POSTIMAGE — lib/services/self-service-link-facts.ts  (candidate, NOT applied)
//
// THE LINK FACTS THE GATE READS.
//
// Two statements, on purpose.
//
//   (1) The LINK rows, `FOR SHARE`. One table, so the lock is exactly the
//       table the revocation path contends on: a revoke that commits
//       first is visible here, and a revoke that starts during this
//       transaction blocks until it commits.
//   (2) Guardian relationship, member and person rows are held FOR SHARE
//       before the LEFT JOIN facts are read; member-audience facts retain
//       their existing unlocked subject behavior. Lock contention may abort
//       one transaction on a deadlock; callers must not treat this as an epoch.
//
// THE LEFT JOIN IS LOAD-BEARING, NOT A STYLE CHOICE. The facts must
// distinguish "this link row is not here" (link_missing) from "this link
// row is here and the relationship behind it is dead" (relationship_not
// live). An INNER JOIN would drop the second case and report it as the
// first, and the two are different facts for the club.
//
// THE AGE IS NEVER CONSULTED. Nothing in this file reads a date of birth,
// and nothing here ends a guardian's access because the child grew up: a
// linked guardian KEEPS the access after the member turns 18, and only an
// explicit revocation ends it.

import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { TenantTx } from "@/db/tenant";
import { guardianships } from "@/db/schema/consent";
import { members, persons } from "@/db/schema/people";
import {
  guardianChildLinks,
  memberAccountLinks,
} from "@/db/schema/member-self";
import type { TenantId, UserId } from "@/lib/ids";

/** The two bases the schema admits. */
export const ATTESTATION_BASES = [
  "owner_attestation",
  "facility_manager_attestation",
] as const;

export type AttestationBasis = (typeof ATTESTATION_BASES)[number];

/**
 * IS THE ATTESTATION QUARTET COMPLETE?
 *
 * The schema's CHECK makes the quartet travel together or not at all, and
 * it makes the two bases mutually exclusive: the OWNER's attestation
 * carries NO facility, the MANAGER's MUST carry one. A reader that asked
 * for a facility on every basis would read the owner's attestation as
 * absent — and the owner's attestation is the common case.
 */
export function attestationQuartetIsPresent(row: {
  confirmedByUserId: string | null;
  confirmedAt: Date | null;
  basis: string | null;
  facilityId: string | null;
}): boolean {
  if (row.confirmedByUserId === null) return false;
  if (row.confirmedAt === null) return false;
  if (row.basis === "owner_attestation") return row.facilityId === null;
  if (row.basis === "facility_manager_attestation") {
    return row.facilityId !== null;
  }
  return false;
}

const guardianChildPerson = alias(persons, "guardian_child_person");

export type LinkFacts = {
  linkId: string;
  /** The membership the link points at (the member's, or the child's). */
  memberId: string | null;
  /** The person the session would act as. */
  personId: string | null;
  /** The link row itself: `status = 'active'` and not revoked. */
  linkIsLive: boolean;
  /** The RELATIONSHIP behind the link. */
  relationshipIsLive: boolean;
  /** Only an explicitly soft-deleted child is omitted from fresh guardian sets. */
  childPersonSoftDeleted: boolean;
  /** The club's snapshot of the number, and that person's current number. */
  recordedPhone: string | null;
  personPhone: string | null;
  /** A standing staff attestation about the ACCOUNT<->MEMBER pairing. */
  attestationQuartetPresent: boolean;
  attestationConfirmerUserId: string | null;
  attestationBasis: string | null;
  attestationFacilityId: string | null;
};

function memberFacts(
  row: {
    linkId: string;
    memberId: string | null;
    status: string;
    revokedAt: Date | null;
    recordedPhone: string | null;
    confirmedByUserId: string | null;
    confirmedAt: Date | null;
    basis: string | null;
    facilityId: string | null;
  },
  subject: {
    personId: string | null;
    personPhone: string | null;
    memberDeletedAt: Date | null;
    personDeletedAt: Date | null;
  } | null,
): LinkFacts {
  const memberLive = subject !== null && subject.memberDeletedAt === null;
  const personLive =
    subject !== null &&
    subject.personDeletedAt === null &&
    subject.personId !== null;
  return {
    linkId: row.linkId,
    memberId: row.memberId,
    personId: personLive ? subject.personId : null,
    linkIsLive: row.status === "active" && row.revokedAt === null,
    relationshipIsLive: memberLive && personLive,
    childPersonSoftDeleted: false,
    recordedPhone: row.recordedPhone,
    personPhone: subject?.personPhone ?? null,
    attestationQuartetPresent: attestationQuartetIsPresent({
      confirmedByUserId: row.confirmedByUserId,
      confirmedAt: row.confirmedAt,
      basis: row.basis,
      facilityId: row.facilityId,
    }),
    attestationConfirmerUserId: row.confirmedByUserId,
    attestationBasis: row.basis,
    attestationFacilityId: row.facilityId,
  };
}

/**
 * Reads the member link rows.
 *
 * THE PERSON HERE IS THE MEMBER'S PERSON. The link's snapshot is the
 * number the club recorded for that person.
 */
export async function readMemberLinkFacts(
  tx: TenantTx,
  args: { tenantId: TenantId; userId: UserId; linkIds: string[] },
): Promise<LinkFacts[]> {
  const locked = await tx
    .select({
      linkId: memberAccountLinks.id,
      memberId: memberAccountLinks.memberId,
      status: memberAccountLinks.status,
      revokedAt: memberAccountLinks.revokedAt,
      recordedPhone: memberAccountLinks.recordedPhone,
      confirmedByUserId: memberAccountLinks.accountBindingConfirmedByUserId,
      confirmedAt: memberAccountLinks.accountBindingConfirmedAt,
      basis: memberAccountLinks.accountBindingBasis,
      facilityId: memberAccountLinks.accountBindingFacilityId,
    })
    .from(memberAccountLinks)
    .where(
      and(
        eq(memberAccountLinks.tenantId, args.tenantId),
        eq(memberAccountLinks.userId, args.userId),
        inArray(memberAccountLinks.id, args.linkIds),
      ),
    )
    .for("share");

  const subjects = await tx
    .select({
      linkId: memberAccountLinks.id,
      personId: persons.id,
      personPhone: persons.phone,
      memberDeletedAt: members.deletedAt,
      personDeletedAt: persons.deletedAt,
    })
    .from(memberAccountLinks)
    .leftJoin(
      members,
      and(
        eq(members.id, memberAccountLinks.memberId),
        eq(members.tenantId, memberAccountLinks.tenantId),
      ),
    )
    .leftJoin(
      persons,
      and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, memberAccountLinks.tenantId),
      ),
    )
    .where(
      and(
        eq(memberAccountLinks.tenantId, args.tenantId),
        eq(memberAccountLinks.userId, args.userId),
        inArray(memberAccountLinks.id, args.linkIds),
      ),
    );

  const byLink = new Map(subjects.map((s) => [s.linkId, s] as const));
  return locked.map((row) => memberFacts(row, byLink.get(row.linkId) ?? null));
}

/**
 * Reads the guardian link rows.
 *
 * THE PERSON HERE IS THE GUARDIAN'S, NOT THE CHILD'S. The guardian
 * link's snapshot is the number the club recorded for the ACCOUNT that
 * holds the link, and the person the session acts as is the adult who
 * holds the child links.
 *
 * WHAT DOES END IT: a withdrawn guardianship, a withdrawn member, a
 * withdrawn member's person row, or a withdrawn guardian's person row —
 * even while the account link row is still `active`.
 */
export async function readGuardianLinkFacts(
  tx: TenantTx,
  args: { tenantId: TenantId; userId: UserId; linkIds: string[] },
): Promise<LinkFacts[]> {
  const locked = await tx
    .select({
      linkId: guardianChildLinks.id,
      memberId: guardianChildLinks.memberId,
      status: guardianChildLinks.status,
      revokedAt: guardianChildLinks.revokedAt,
      recordedPhone: guardianChildLinks.recordedPhone,
      confirmedByUserId: guardianChildLinks.accountBindingConfirmedByUserId,
      confirmedAt: guardianChildLinks.accountBindingConfirmedAt,
      basis: guardianChildLinks.accountBindingBasis,
      facilityId: guardianChildLinks.accountBindingFacilityId,
    })
    .from(guardianChildLinks)
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        inArray(guardianChildLinks.id, args.linkIds),
      ),
    )
    .orderBy(asc(guardianChildLinks.id))
    .for("share");

  // Lock the bound relationship and member first, then their person rows in
  // stable ID order. The subsequent facts/read remain in this transaction.
  const relationshipRows = await tx.select({ guardianId: guardianships.guardianId })
    .from(guardianChildLinks).innerJoin(guardianships, and(
      eq(guardianships.id, guardianChildLinks.guardianshipId),
      eq(guardianships.tenantId, guardianChildLinks.tenantId)))
    .where(and(eq(guardianChildLinks.tenantId, args.tenantId), eq(guardianChildLinks.userId, args.userId), inArray(guardianChildLinks.id, args.linkIds)))
    .orderBy(asc(guardianships.id)).for("share", { of: guardianships });
  const memberRows = await tx.select({ personId: members.personId })
    .from(guardianChildLinks).innerJoin(members, and(
      eq(members.id, guardianChildLinks.memberId), eq(members.tenantId, guardianChildLinks.tenantId)))
    .where(and(eq(guardianChildLinks.tenantId, args.tenantId), eq(guardianChildLinks.userId, args.userId), inArray(guardianChildLinks.id, args.linkIds)))
    .orderBy(asc(members.id)).for("share", { of: members });
  const personIds = [...new Set([...relationshipRows.map((r) => r.guardianId), ...memberRows.map((r) => r.personId)].filter((id): id is NonNullable<typeof id> => id !== null))];
  if (personIds.length) await tx.select({ id: persons.id }).from(persons)
    .where(and(eq(persons.tenantId, args.tenantId), inArray(persons.id, personIds)))
    .orderBy(asc(persons.id)).for("share");

  const subjects = await tx
    .select({
      linkId: guardianChildLinks.id,
      personId: persons.id,
      personPhone: persons.phone,
      guardianDeletedAt: guardianships.deletedAt,
      personDeletedAt: persons.deletedAt,
      memberDeletedAt: members.deletedAt,
      childPersonId: members.personId,
      childPersonRowId: guardianChildPerson.id,
      childPersonDeletedAt: guardianChildPerson.deletedAt,
      minorId: guardianships.minorId,
    })
    .from(guardianChildLinks)
    .leftJoin(
      guardianships,
      and(
        eq(guardianships.id, guardianChildLinks.guardianshipId),
        eq(guardianships.tenantId, guardianChildLinks.tenantId),
      ),
    )
    .leftJoin(
      persons,
      and(
        eq(persons.id, guardianships.guardianId),
        eq(persons.tenantId, guardianChildLinks.tenantId),
      ),
    )
    .leftJoin(
      members,
      and(
        eq(members.id, guardianChildLinks.memberId),
        eq(members.tenantId, guardianChildLinks.tenantId),
      ),
    )
    .leftJoin(guardianChildPerson, and(
      eq(guardianChildPerson.id, members.personId),
      eq(guardianChildPerson.tenantId, guardianChildLinks.tenantId),
    ))
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        inArray(guardianChildLinks.id, args.linkIds),
      ),
    );

  const byLink = new Map(subjects.map((s) => [s.linkId, s] as const));
  return locked.map((row) => {
    const subject = byLink.get(row.linkId) ?? null;
    const guardianshipLive =
      subject !== null &&
      subject.guardianDeletedAt === null &&
      subject.minorId !== null;
    const guardianPersonLive =
      subject !== null &&
      subject.personDeletedAt === null &&
      subject.personId !== null;
    // THE PINNED MEMBERSHIP MUST BE THE CHILD'S. A link re-pointed at
    // another member's row is out of the live set.
    const childLive =
      subject !== null &&
      subject.memberDeletedAt === null &&
      subject.childPersonId !== null &&
      subject.childPersonRowId !== null &&
      subject.childPersonDeletedAt === null &&
      subject.childPersonId === subject.minorId;
    return {
      linkId: row.linkId,
      memberId: row.memberId,
      personId: guardianPersonLive ? subject.personId : null,
      linkIsLive: row.status === "active" && row.revokedAt === null,
      relationshipIsLive: guardianshipLive && guardianPersonLive && childLive,
      childPersonSoftDeleted: row.status === "active" && row.revokedAt === null &&
        guardianshipLive && guardianPersonLive && subject !== null &&
        subject.memberDeletedAt === null && subject.childPersonId !== null &&
        subject.childPersonId === subject.minorId && subject.childPersonRowId !== null &&
        subject.childPersonDeletedAt !== null,
      recordedPhone: row.recordedPhone,
      personPhone: subject?.personPhone ?? null,
      attestationQuartetPresent: attestationQuartetIsPresent({
        confirmedByUserId: row.confirmedByUserId,
        confirmedAt: row.confirmedAt,
        basis: row.basis,
        facilityId: row.facilityId,
      }),
      attestationConfirmerUserId: row.confirmedByUserId,
      attestationBasis: row.basis,
      attestationFacilityId: row.facilityId,
    };
  });
}

/** The facts for one audience. */
export async function readLinkFacts(
  tx: TenantTx,
  args: {
    tenantId: TenantId;
    userId: UserId;
    audience: "member" | "guardian";
    linkIds: string[];
  },
): Promise<LinkFacts[]> {
  return args.audience === "member"
    ? await readMemberLinkFacts(tx, args)
    : await readGuardianLinkFacts(tx, args);
}

/**
 * THE ACCOUNT'S LIVE LINK ROWS IN ONE CLUB, `FOR SHARE`.
 *
 * The staff branch has NO bound set — there is no session row to bind to
 * — so its scope IS the account's live linkage rows IN THIS TENANT. It
 * needs their ids before it can read their facts, and the lock is taken
 * here so a concurrent revoke cannot slip under the read that follows.
 */
export async function readLiveLinkIds(
  tx: TenantTx,
  args: {
    tenantId: TenantId;
    userId: UserId;
    audience: "member" | "guardian";
  },
): Promise<string[]> {
  if (args.audience === "member") {
    const rows = await tx
      .select({ id: memberAccountLinks.id })
      .from(memberAccountLinks)
      .where(
        and(
          eq(memberAccountLinks.tenantId, args.tenantId),
          eq(memberAccountLinks.userId, args.userId),
          eq(memberAccountLinks.status, "active"),
        ),
      )
      .for("share");
    return rows.map((r) => r.id);
  }
  const rows = await tx
    .select({ id: guardianChildLinks.id })
    .from(guardianChildLinks)
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        eq(guardianChildLinks.status, "active"),
      ),
    )
    .orderBy(asc(guardianChildLinks.id))
    .for("share");
  return rows.map((r) => r.id);
}

/**
 * GATE 1 — THE CLUB'S RECORD FOR THIS PERSON. NEVER OVERRIDABLE.
 *
 * A NULL snapshot, or a NULL current number, FAILS CLOSED here.
 *
 * THE RESIDUAL, STATED: whether a CHANGED club record invalidates an
 * otherwise valid identity confirmation is a question no human has
 * settled. This file keeps the EXISTING implementation's answer (the
 * club's record must still be current) rather than inventing a new one,
 * and the handoff names the question.
 */
export function clubRecordIsCurrent(
  recordedPhone: string | null,
  personPhone: string | null,
): boolean {
  if (recordedPhone === null) return false;
  if (personPhone === null) return false;
  return recordedPhone === personPhone;
}
