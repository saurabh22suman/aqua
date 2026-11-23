// POSTIMAGE — lib/services/self-service-activation-link.ts  (candidate, NOT applied)
//
// THE NAMED LINK ROW, READ FOR UPDATE.
//
// A TOKEN NAMES EXACTLY ONE LINKAGE ROW, and this module is the only
// place that row is read. It is read through the caller's transaction,
// with a FOR UPDATE lock on the link row itself, so two activations
// cannot both decide to flip it.
//
// TWO STATEMENTS, ON PURPOSE — the same shape the corrected core's facts
// reader uses:
//
//   (1) THE LINK ROW, locked. The lock is on the link table alone, which
//       is the table the revocation path contends on.
//   (2) THE SUBJECT FACTS, unlocked. A soft-delete of a member, a person
//       or a guardianship between the two statements is a one-request
//       window, and this module takes no lock on that read.
//
// THE GUARDIAN ROW PINS THE CHILD'S MEMBERSHIP, exactly as the corrected
// core's facts reader does: a guardian link whose `member_id` is not the
// child's own membership is ABSENT here, and an absent row is a refusal.
//
// THE CLUB'S RECORD IS NOT A PROOF OF POSSESSION. The recorded number is
// the CLUB'S RECORD of the person. This product has no OTP and no SMS,
// and nothing here asserts that anybody owns a phone.

import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { guardianships } from "@/db/schema/consent";
import { members, persons } from "@/db/schema/people";
import {
  guardianChildLinks,
  memberAccountLinks,
} from "@/db/schema/member-self";
import type { SelfServiceAudience } from "@/db/schema/self-service-session";
import type { TenantId, UserId } from "@/lib/ids";

export type ActivationLinkRow = {
  /** The link row's own id — the token names exactly this one. */
  id: string;
  /** The membership the link points at (the member's, or the child's). */
  memberId: string | null;
  /** `invited`, `active` or `revoked`. */
  status: string;
  /** The club's snapshot of the number, and that person's current number. */
  recordedPhone: string | null;
  personPhone: string | null;
  /** What the audit row is about: the membership, or the guardianship. */
  entityType: "member" | "guardianship";
  entityId: string | null;
};

/**
 * THE NAMED ROW, or null.
 *
 * `null` covers every "this token does not name a live linkage row in
 * this club for this account" case, and the caller fails closed on it.
 */
export async function readNamedActivationLink(
  tx: TenantTx,
  args: {
    tenantId: TenantId;
    userId: UserId;
    audience: SelfServiceAudience;
    linkId: string;
  },
): Promise<ActivationLinkRow | null> {
  if (args.audience === "member") {
    const locked = await tx
      .select({
        id: memberAccountLinks.id,
        memberId: memberAccountLinks.memberId,
        status: memberAccountLinks.status,
        recordedPhone: memberAccountLinks.recordedPhone,
      })
      .from(memberAccountLinks)
      .where(
        and(
          eq(memberAccountLinks.tenantId, args.tenantId),
          eq(memberAccountLinks.userId, args.userId),
          eq(memberAccountLinks.id, args.linkId),
        ),
      )
      .limit(1)
      .for("update");
    const row = locked[0];
    if (!row) return null;

    const subject = await tx
      .select({ personPhone: persons.phone })
      .from(memberAccountLinks)
      .innerJoin(
        members,
        and(
          eq(members.id, memberAccountLinks.memberId),
          eq(members.tenantId, memberAccountLinks.tenantId),
          isNull(members.deletedAt),
        ),
      )
      .innerJoin(
        persons,
        and(
          eq(persons.id, members.personId),
          eq(persons.tenantId, memberAccountLinks.tenantId),
          isNull(persons.deletedAt),
        ),
      )
      .where(
        and(
          eq(memberAccountLinks.tenantId, args.tenantId),
          eq(memberAccountLinks.userId, args.userId),
          eq(memberAccountLinks.id, args.linkId),
        ),
      )
      .limit(1);
    const subjectRow = subject[0];
    if (!subjectRow) return null;

    return {
      id: row.id,
      memberId: row.memberId,
      status: row.status,
      recordedPhone: row.recordedPhone,
      personPhone: subjectRow.personPhone,
      entityType: "member",
      entityId: row.memberId,
    };
  }

  const locked = await tx
    .select({
      id: guardianChildLinks.id,
      memberId: guardianChildLinks.memberId,
      status: guardianChildLinks.status,
      recordedPhone: guardianChildLinks.recordedPhone,
      guardianshipId: guardianChildLinks.guardianshipId,
    })
    .from(guardianChildLinks)
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        eq(guardianChildLinks.id, args.linkId),
      ),
    )
    .limit(1)
    .for("update");
  const row = locked[0];
  if (!row) return null;

  // THE PINNED MEMBERSHIP MUST BE THE CHILD'S. The join carries
  // `members.person_id = guardianships.minor_id`, so a link re-pointed at
  // another member's row is ABSENT here and the activation is refused.
  const subject = await tx
    .select({ personPhone: persons.phone })
    .from(guardianChildLinks)
    .innerJoin(
      guardianships,
      and(
        eq(guardianships.id, guardianChildLinks.guardianshipId),
        eq(guardianships.tenantId, guardianChildLinks.tenantId),
        isNull(guardianships.deletedAt),
      ),
    )
    .innerJoin(
      members,
      and(
        eq(members.id, guardianChildLinks.memberId),
        eq(members.tenantId, guardianChildLinks.tenantId),
        eq(members.personId, guardianships.minorId),
        isNull(members.deletedAt),
      ),
    )
    .innerJoin(
      persons,
      and(
        eq(persons.id, guardianships.guardianId),
        eq(persons.tenantId, guardianChildLinks.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .where(
      and(
        eq(guardianChildLinks.tenantId, args.tenantId),
        eq(guardianChildLinks.userId, args.userId),
        eq(guardianChildLinks.id, args.linkId),
      ),
    )
    .limit(1);
  const subjectRow = subject[0];
  if (!subjectRow) return null;

  return {
    id: row.id,
    memberId: row.memberId,
    status: row.status,
    recordedPhone: row.recordedPhone,
    personPhone: subjectRow.personPhone,
    entityType: "guardianship",
    entityId: row.guardianshipId,
  };
}
