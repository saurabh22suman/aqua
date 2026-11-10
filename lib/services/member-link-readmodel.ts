// THE OWNER-SIDE READ OF ONE MEMBER'S SIGN-IN LINKS.
//
// ONE SCOPE, THREE FILTERS, ONE NAMED EXCEPTION:
//   1. THE TENANT. Every row is read inside withTenant(ctx.tenantId).
//   2. THE ACTOR'S REAL AUTHORITY, read from the database through
//      readLinkAuthorities: the actor's LIVE membership, the grant its
//      role carries and the facilities it is CURRENTLY assigned to. A
//      scope claimed in the context buys nothing here.
//   3. THE MEMBER, locked BEFORE the authority is checked, so a facility
//      move cannot land between the check and the result.
//
// THE ACCOUNT NUMBER is the ONE bounded exception, pending the
// coordinator's approval: `users.phone` for the account each link
// ALREADY points at, reached ONLY through this tenant's own link rows.
// No other column of `users` is read, no account is searched for, no
// account is created.
//
// A CONFIRMATION STANDS ONLY IF IT STILL STANDS: the quartet says it was
// MADE, the confirmer's live authority says it still STANDS. A lapsed
// attestation is HISTORY and is never an active confirmation.
//
// A MISSING MEMBER AND AN OUT-OF-SCOPE MEMBER ARE THE SAME ANSWER (null).

import { and, desc, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { guardianships } from "@/db/schema/consent";
import { locations } from "@/db/schema/locations";
import { members, persons } from "@/db/schema/people";
import {
  guardianChildLinks,
  memberAccountLinks,
} from "@/db/schema/member-self";
import { users } from "@/db/schema/users";
import type { ActionCtx } from "@/lib/auth/context";
import {
  attestationAuthorityStands,
  readLinkAuthorities,
  type LinkAuthority,
} from "@/lib/services/member-link-authority";
import { attestationQuartetIsPresent } from "@/lib/services/self-service-link-facts";
import { asMemberId } from "@/lib/ids";

export type MemberAccessAudience = "member" | "guardian";

export type MemberAccessStatus = "invited" | "active" | "revoked";

export type MemberAccessLink = {
  linkId: string;
  audience: MemberAccessAudience;
  status: MemberAccessStatus;
  /** TRUE only when the attestation is complete AND its confirmer stands. */
  confirmed: boolean;
  /** TRUE when an attestation was recorded and it no longer stands. */
  confirmationLapsed: boolean;
  /** The RECORDED attestation — the history, kept even when it lapsed. */
  confirmedAt: string | null;
  confirmedBasis: string | null;
  /** The linked account's CURRENT sign-in number. null = unknown account. */
  accountPhone: string | null;
  /** The club's record of the person today (persons.phone). */
  clubPhone: string | null;
  /** The person the link is about: the member, or the guardian. */
  personName: string;
  /** The guardianship relationship — a guardian link only. */
  relationship: string | null;
};

export type MemberAccessRead = {
  memberId: string;
  memberName: string;
  memberCode: string;
  facilityName: string;
  links: MemberAccessLink[];
};

/** What both link tables project. */
type LinkProjection = {
  linkId: string;
  audience: MemberAccessAudience;
  status: string;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  basis: string | null;
  facilityId: string | null;
  accountPhone: string | null;
  personName: string;
  relationship: string | null;
  clubPhone: string | null;
};

/**
 * THE STANDING OF ONE ATTESTATION. The quartet says it was MADE; the
 * confirmer's live authority says it still STANDS.
 */
function toLink(
  row: LinkProjection,
  authorities: Map<string, LinkAuthority>,
): MemberAccessLink {
  const quartet = attestationQuartetIsPresent({
    confirmedByUserId: row.confirmedBy,
    confirmedAt: row.confirmedAt,
    basis: row.basis,
    facilityId: row.facilityId,
  });
  const stands = attestationAuthorityStands({
    quartetPresent: quartet,
    confirmerUserId: row.confirmedBy,
    basis: row.basis,
    facilityId: row.facilityId,
    authority:
      row.confirmedBy === null ? undefined : authorities.get(row.confirmedBy),
  });
  return {
    linkId: row.linkId,
    audience: row.audience,
    status:
      row.status === "invited" ? "invited" : row.status === "revoked" ? "revoked" : "active",
    confirmed: quartet && stands,
    confirmationLapsed: quartet && !stands,
    confirmedAt: quartet && row.confirmedAt ? row.confirmedAt.toISOString() : null,
    confirmedBasis: quartet ? row.basis : null,
    accountPhone: row.accountPhone,
    clubPhone: row.clubPhone,
    personName: row.personName,
    relationship: row.relationship,
  };
}

/**
 * THE LINKS OF ONE MEMBER, AS THE ACTOR MAY ACT ON THEM. Null when the
 * member is not visible to this actor at all — it does not exist in this
 * club, or it sits outside the facilities the actor currently holds.
 */
export async function readMemberAccessLinks(
  ctx: ActionCtx,
  rawMemberId: string,
): Promise<MemberAccessRead | null> {
  const actorUserId = ctx.userId;
  if (!actorUserId) return null;
  const memberId = asMemberId(rawMemberId);

  return withTenant(ctx.tenantId, async (tx) => {
    // THE MEMBER, LOCKED. FOR SHARE holds the member, the person and the
    // facility rows until this transaction ends, so a facility move
    // cannot land between the authority check and the result.
    const subjectRows = await tx
      .select({
        memberId: members.id,
        personId: members.personId,
        memberCode: members.memberCode,
        facilityId: members.locationId,
        memberName: persons.fullName,
        clubPhone: persons.phone,
        facilityName: locations.name,
      })
      .from(members)
      .innerJoin(persons, and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, members.tenantId),
        isNull(persons.deletedAt),
      ))
      .innerJoin(locations, and(
        eq(locations.id, members.locationId),
        eq(locations.tenantId, members.tenantId),
        isNull(locations.deletedAt),
      ))
      .where(and(
        eq(members.id, memberId),
        eq(members.tenantId, ctx.tenantId),
        isNull(members.deletedAt),
      ))
      .limit(1)
      .for("share");
    const subject = subjectRows[0];
    if (!subject) return null;

    // THE ACTOR'S REAL AUTHORITY, read from the database. The context's
    // claimed scope is not consulted.
    const authority = (
      await readLinkAuthorities(tx, {
        tenantId: ctx.tenantId,
        userIds: [actorUserId],
      })
    ).get(actorUserId);
    if (!authority || !authority.live) return null;
    if (
      !authority.unrestricted &&
      !authority.facilityIds.includes(subject.facilityId)
    ) {
      return null;
    }

    // THE MEMBER'S OWN LINKS. The account is reached ONLY through this
    // tenant's link row, and only `users.phone` is read. A LEFT JOIN
    // keeps a link whose account cannot be read IN THE LIST, with an
    // unknown account, so the club can see it and refuse to confirm it.
    const memberLinkRows: LinkProjection[] = (
      await tx
        .select({
          linkId: memberAccountLinks.id,
          status: memberAccountLinks.status,
          confirmedBy: memberAccountLinks.accountBindingConfirmedByUserId,
          confirmedAt: memberAccountLinks.accountBindingConfirmedAt,
          basis: memberAccountLinks.accountBindingBasis,
          facilityId: memberAccountLinks.accountBindingFacilityId,
          accountPhone: users.phone,
        })
        .from(memberAccountLinks)
        .leftJoin(users, and(
          eq(users.id, memberAccountLinks.userId),
          isNull(users.deletedAt),
        ))
        .where(and(
          eq(memberAccountLinks.tenantId, ctx.tenantId),
          eq(memberAccountLinks.memberId, memberId),
        ))
        .orderBy(desc(memberAccountLinks.createdAt))
    ).map((row) => ({
      ...row,
      audience: "member" as const,
      personName: subject.memberName,
      relationship: null,
      clubPhone: subject.clubPhone,
    }));

    // THE GUARDIAN LINKS. A guardian row belongs to a child: it is read
    // only through a LIVE guardianship whose minor IS this member's
    // person, and only when the link's pinned membership is this
    // member's. A link re-pointed at another member, a withdrawn
    // guardianship and a guardian row with no pinned membership are all
    // out of the set.
    const guardianLinkRows: LinkProjection[] = (
      await tx
        .select({
          linkId: guardianChildLinks.id,
          status: guardianChildLinks.status,
          confirmedBy: guardianChildLinks.accountBindingConfirmedByUserId,
          confirmedAt: guardianChildLinks.accountBindingConfirmedAt,
          basis: guardianChildLinks.accountBindingBasis,
          facilityId: guardianChildLinks.accountBindingFacilityId,
          accountPhone: users.phone,
          personName: persons.fullName,
          relationship: guardianships.relationship,
          clubPhone: persons.phone,
        })
        .from(guardianChildLinks)
        .innerJoin(guardianships, and(
          eq(guardianships.id, guardianChildLinks.guardianshipId),
          eq(guardianships.tenantId, guardianChildLinks.tenantId),
          isNull(guardianships.deletedAt),
          eq(guardianships.minorId, subject.personId),
        ))
        .innerJoin(persons, and(
          eq(persons.id, guardianships.guardianId),
          eq(persons.tenantId, guardianChildLinks.tenantId),
          isNull(persons.deletedAt),
        ))
        .leftJoin(users, and(
          eq(users.id, guardianChildLinks.userId),
          isNull(users.deletedAt),
        ))
        .where(and(
          eq(guardianChildLinks.tenantId, ctx.tenantId),
          eq(guardianChildLinks.memberId, memberId),
        ))
        .orderBy(desc(guardianChildLinks.createdAt))
    ).map((row) => ({ ...row, audience: "guardian" as const }));

    const rows: LinkProjection[] = [...memberLinkRows, ...guardianLinkRows];

    // THE CONFIRMERS' PROVENANCE — read ONCE for the whole read, inside
    // this transaction, in this club's scope.
    const confirmerIds = [
      ...new Set(
        rows
          .filter((row) => row.confirmedBy !== null)
          .map((row) => row.confirmedBy as string),
      ),
    ];
    const authorities = await readLinkAuthorities(tx, {
      tenantId: ctx.tenantId,
      userIds: confirmerIds,
    });

    return {
      memberId: subject.memberId,
      memberName: subject.memberName,
      memberCode: subject.memberCode,
      facilityName: subject.facilityName,
      links: rows.map((row) => toLink(row, authorities)),
    };
  });
}
