// POSTIMAGE — lib/services/member-link-binding.ts  (candidate, NOT applied)
//
// THE STAFF SIDE OF THE PAIRING.
//
// Four operations, one file, one authority model:
//
//   confirmLinkBinding       - the club stands behind a pairing;
//   withdrawLinkBinding      - the club takes that standing back;
//   issueMemberActivationToken - the member's one-time activation link;
//   provisionMemberAccountLink - the link row the activation consumes.
//
// THE AUTHORITY IS THE ACTOR'S OWN MEMBERSHIP ROW, NOT THE CONTEXT. A
// caller that claims a wider facility scope than it holds gets no wider
// authority.
//
// THE MISMATCH IS NEVER A REFUSAL CONDITION. The club's position IS the
// confirmation; the club does not un-confirm it because two numbers
// differ. What the club MUST have is a CURRENT record: a link whose
// snapshot no longer matches the person's current number is refused
// ("not_confirmable"), because the confirmation is about the club's record
// and the record has changed.
//
// NO SMS AND NO OTP. Nothing here queues a message, nothing here records
// that anybody owns a number, and nothing here rewrites the club's
// recorded number or the account's number.

import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant, type TenantTx } from "@/db/tenant";
import { writeAudit } from "@/lib/audit/write";
import type { ActionCtx } from "@/lib/auth/context";
import { guardianships } from "@/db/schema/consent";
import { members, persons } from "@/db/schema/people";
import {
  guardianChildLinks,
  memberAccountLinks,
} from "@/db/schema/member-self";
import {
  readLinkAuthorities,
  type LinkAuthority,
} from "@/lib/services/member-link-authority";
import {
  attestationQuartetIsPresent,
  clubRecordIsCurrent,
} from "@/lib/services/self-service-link-facts";
import {
  signSelfServiceToken,
} from "@/lib/services/self-service-token";
import { asTenantId, asMemberId, asUserId } from "@/lib/ids";

export type LinkAudience = "member" | "guardian";

export type BindingActionResult =
  | { kind: "ok"; linkId: string }
  | { kind: "error"; code: string; message: string };

export type ActivationTokenResult =
  | { kind: "ok"; linkId: string; token: string; expiresAt: Date }
  | { kind: "error"; code: string; message: string };

export type ProvisionResult =
  | { kind: "ok"; linkId: string }
  | { kind: "error"; code: string; message: string };

/**
 * ONE UNIFORM REFUSAL for every "you cannot see this" case: a link in
 * another club, a link that does not exist, a revoked link, a link whose
 * subject is outside the actor's scope, and a link the actor has no
 * authority over are all "not_found". A surface that can tell them apart
 * is an oracle.
 */
function notFound(): BindingActionResult {
  return {
    kind: "error",
    code: "not_found",
    message: "No such link.",
  };
}

function refuse(code: string, message: string): BindingActionResult {
  return { kind: "error", code, message };
}

/** The link row and the facts the decision needs. */
type LinkTarget = {
  linkId: string;
  userId: string;
  memberId: string | null;
  status: string;
  recordedPhone: string | null;
  personPhone: string | null;
  /** The facility that decides the actor's scope for this link. */
  facilityId: string | null;
  /** The entity the audit row names: the member, or the guardianship. */
  entityType: "member" | "guardianship";
  entityId: string | null;
  /** The subject the session will be ABOUT (the member audience only). */
  subjectId: string | null;
  hasQuartet: boolean;
};

async function readLinkTarget(
  tx: TenantTx,
  args: { tenantId: string; audience: LinkAudience; linkId: string },
): Promise<LinkTarget | null> {
  if (args.audience === "member") {
    const rows = await tx
      .select({
        linkId: memberAccountLinks.id,
        userId: memberAccountLinks.userId,
        memberId: memberAccountLinks.memberId,
        status: memberAccountLinks.status,
        recordedPhone: memberAccountLinks.recordedPhone,
        personPhone: persons.phone,
        facilityId: members.locationId,
        confirmedBy: memberAccountLinks.accountBindingConfirmedByUserId,
        confirmedAt: memberAccountLinks.accountBindingConfirmedAt,
        basis: memberAccountLinks.accountBindingBasis,
        facility: memberAccountLinks.accountBindingFacilityId,
      })
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
          eq(memberAccountLinks.tenantId, asTenantId(args.tenantId)),
          eq(memberAccountLinks.id, args.linkId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      linkId: row.linkId,
      userId: row.userId,
      memberId: row.memberId,
      status: row.status,
      recordedPhone: row.recordedPhone,
      personPhone: row.personPhone,
      facilityId: row.facilityId,
      entityType: "member",
      entityId: row.memberId,
      subjectId: row.memberId,
      hasQuartet: attestationQuartetIsPresent({
        confirmedByUserId: row.confirmedBy,
        confirmedAt: row.confirmedAt,
        basis: row.basis,
        facilityId: row.facility,
      }),
    };
  }

  const rows = await tx
    .select({
      linkId: guardianChildLinks.id,
      userId: guardianChildLinks.userId,
      memberId: guardianChildLinks.memberId,
      status: guardianChildLinks.status,
      recordedPhone: guardianChildLinks.recordedPhone,
      personPhone: persons.phone,
      facilityId: members.locationId,
      childPersonId: members.personId,
      minorId: guardianships.minorId,
      guardianshipId: guardianChildLinks.guardianshipId,
      confirmedBy: guardianChildLinks.accountBindingConfirmedByUserId,
      confirmedAt: guardianChildLinks.accountBindingConfirmedAt,
      basis: guardianChildLinks.accountBindingBasis,
      facility: guardianChildLinks.accountBindingFacilityId,
    })
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
      persons,
      and(
        eq(persons.id, guardianships.guardianId),
        eq(persons.tenantId, guardianChildLinks.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .leftJoin(
      members,
      and(
        eq(members.id, guardianChildLinks.memberId),
        eq(members.tenantId, guardianChildLinks.tenantId),
        isNull(members.deletedAt),
      ),
    )
    .where(
      and(
        eq(guardianChildLinks.tenantId, asTenantId(args.tenantId)),
        eq(guardianChildLinks.id, args.linkId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // THE PINNED MEMBERSHIP MUST BE THE CHILD'S. A link re-pointed at
  // another member's row is out of the live set.
  if (row.childPersonId !== null && row.minorId !== null) {
    if (row.childPersonId !== row.minorId) return null;
  }
  return {
    linkId: row.linkId,
    userId: row.userId,
    memberId: row.memberId,
    status: row.status,
    recordedPhone: row.recordedPhone,
    personPhone: row.personPhone,
    facilityId: row.facilityId,
    entityType: "guardianship",
    entityId: row.guardianshipId,
    subjectId: null,
    hasQuartet: attestationQuartetIsPresent({
      confirmedByUserId: row.confirmedBy,
      confirmedAt: row.confirmedAt,
      basis: row.basis,
      facilityId: row.facility,
    }),
  };
}

/**
 * MAY THIS ACTOR ACT ON THIS LINK?
 *
 * The grant is the authority; the facility set is the scope. A club-wide
 * holder may act anywhere in the club; a facility-limited holder may act
 * only inside the facilities they are assigned to, and the SUBJECT's
 * facility decides — for the member audience the member's own facility,
 * for the guardian audience the CHILD's facility (the link's pinned
 * membership).
 */
function actorCovers(
  authority: LinkAuthority | undefined,
  target: LinkTarget,
): boolean {
  if (!authority || !authority.live) return false;
  if (authority.unrestricted) return true;
  if (target.facilityId === null) return false;
  return authority.facilityIds.includes(target.facilityId);
}

/**
 * CONFIRMS THE PAIRING.
 *
 * The confirmation is a STAFF ATTESTATION ABOUT A PAIRING. It carries no
 * number, it never sets phone_number_verified, and it never rewrites the
 * club's recorded number or the account's number.
 */
export async function confirmLinkBinding(
  ctx: ActionCtx,
  input: { audience: LinkAudience; linkId: string },
): Promise<BindingActionResult> {
  const actorUserId = ctx.userId;
  if (!actorUserId) return notFound();

  return withTenant(ctx.tenantId, async (tx) => {
    const target = await readLinkTarget(tx, {
      tenantId: ctx.tenantId,
      audience: input.audience,
      linkId: input.linkId,
    });
    if (!target) return notFound();
    if (target.status === "revoked") return notFound();

    const authority = (
      await readLinkAuthorities(tx, {
        tenantId: ctx.tenantId,
        userIds: [actorUserId],
      })
    ).get(actorUserId);
    if (!actorCovers(authority, target)) return notFound();

    // THE CLUB'S RECORD MUST BE CURRENT. A link whose snapshot no longer
    // matches the person's current number cannot stand behind a pairing:
    // the record it attests is not the record the club holds.
    if (!clubRecordIsCurrent(target.recordedPhone, target.personPhone)) {
      return refuse(
        "not_confirmable",
        "The club's record for this person has changed.",
      );
    }

    const basis = authority?.unrestricted
      ? "owner_attestation"
      : "facility_manager_attestation";
    const facilityId = authority?.unrestricted ? null : target.facilityId;

    const updated =
      input.audience === "member"
        ? await tx
            .update(memberAccountLinks)
            .set({
              accountBindingConfirmedByUserId: actorUserId,
              accountBindingConfirmedAt: new Date(),
              accountBindingBasis: basis,
              accountBindingFacilityId: facilityId,
              updatedAt: new Date(),
              updatedBy: actorUserId,
            })
            .where(
              and(
                eq(memberAccountLinks.id, target.linkId),
                eq(memberAccountLinks.tenantId, ctx.tenantId),
              ),
            )
            .returning({ id: memberAccountLinks.id })
        : await tx
            .update(guardianChildLinks)
            .set({
              accountBindingConfirmedByUserId: actorUserId,
              accountBindingConfirmedAt: new Date(),
              accountBindingBasis: basis,
              accountBindingFacilityId: facilityId,
              updatedAt: new Date(),
              updatedBy: actorUserId,
            })
            .where(
              and(
                eq(guardianChildLinks.id, target.linkId),
                eq(guardianChildLinks.tenantId, ctx.tenantId),
              ),
            )
            .returning({ id: guardianChildLinks.id });

    if (updated.length === 0) return notFound();

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: actorUserId,
      action:
        input.audience === "member"
          ? "member.account_link.confirm_binding"
          : "guardian.child_link.confirm_binding",
      entityType: target.entityType,
      entityId: target.entityId,
      before: { attestation: "none" },
      // NO NUMBER. Not the member's, not the account's, not a hash of
      // either: a fingerprint of a number is still a claim about a number.
      after: {
        linkId: target.linkId,
        audience: input.audience,
        basis,
        facilityId,
      },
      changedFields: [
        "account_binding_confirmed_by_user_id",
        "account_binding_confirmed_at",
        "account_binding_basis",
        "account_binding_facility_id",
      ],
      requestId: ctx.requestId ?? null,
    });

    return { kind: "ok", linkId: target.linkId };
  });
}

/**
 * TAKES THE STANDING CONFIRMATION BACK.
 *
 * A confirmation that cannot be revoked is not a confirmation the club
 * stands behind. Withdrawing a link that carries no confirmation is
 * "nothing_to_withdraw" and writes nothing.
 */
export async function withdrawLinkBinding(
  ctx: ActionCtx,
  input: { audience: LinkAudience; linkId: string },
): Promise<BindingActionResult> {
  const actorUserId = ctx.userId;
  if (!actorUserId) return notFound();

  return withTenant(ctx.tenantId, async (tx) => {
    const target = await readLinkTarget(tx, {
      tenantId: ctx.tenantId,
      audience: input.audience,
      linkId: input.linkId,
    });
    if (!target) return notFound();
    if (target.status === "revoked") return notFound();

    const authority = (
      await readLinkAuthorities(tx, {
        tenantId: ctx.tenantId,
        userIds: [actorUserId],
      })
    ).get(actorUserId);
    if (!actorCovers(authority, target)) return notFound();

    if (!target.hasQuartet) {
      return refuse("nothing_to_withdraw", "There is no confirmation to withdraw.");
    }

    const cleared =
      input.audience === "member"
        ? await tx
            .update(memberAccountLinks)
            .set({
              accountBindingConfirmedByUserId: null,
              accountBindingConfirmedAt: null,
              accountBindingBasis: null,
              accountBindingFacilityId: null,
              updatedAt: new Date(),
              updatedBy: actorUserId,
            })
            .where(
              and(
                eq(memberAccountLinks.id, target.linkId),
                eq(memberAccountLinks.tenantId, ctx.tenantId),
              ),
            )
            .returning({ id: memberAccountLinks.id })
        : await tx
            .update(guardianChildLinks)
            .set({
              accountBindingConfirmedByUserId: null,
              accountBindingConfirmedAt: null,
              accountBindingBasis: null,
              accountBindingFacilityId: null,
              updatedAt: new Date(),
              updatedBy: actorUserId,
            })
            .where(
              and(
                eq(guardianChildLinks.id, target.linkId),
                eq(guardianChildLinks.tenantId, ctx.tenantId),
              ),
            )
            .returning({ id: guardianChildLinks.id });

    if (cleared.length === 0) return notFound();

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: actorUserId,
      action:
        input.audience === "member"
          ? "member.account_link.withdraw_binding"
          : "guardian.child_link.withdraw_binding",
      entityType: target.entityType,
      entityId: target.entityId,
      before: { attestation: "standing" },
      after: { linkId: target.linkId, audience: input.audience, attestation: "none" },
      changedFields: [
        "account_binding_confirmed_by_user_id",
        "account_binding_confirmed_at",
        "account_binding_basis",
        "account_binding_facility_id",
      ],
      requestId: ctx.requestId ?? null,
    });

    return { kind: "ok", linkId: target.linkId };
  });
}

/**
 * ISSUES THE MEMBER'S ONE-TIME ACTIVATION LINK.
 *
 * The token is the CREDENTIAL for the activation: it proves possession of
 * the link and nothing else. It is never queued to the outbox — the
 * messaging provider is mock outside production and the mock pretends to
 * deliver — and it is never sent to anybody by this service.
 */
export async function issueMemberActivationToken(
  ctx: ActionCtx,
  input: { audience: LinkAudience; linkId: string },
): Promise<ActivationTokenResult> {
  const actorUserId = ctx.userId;
  if (!actorUserId) return { kind: "error", code: "not_found", message: "No such link." };

  return withTenant(ctx.tenantId, async (tx) => {
    const target = await readLinkTarget(tx, {
      tenantId: ctx.tenantId,
      audience: input.audience,
      linkId: input.linkId,
    });
    if (!target) return { kind: "error", code: "not_found", message: "No such link." };
    if (target.status !== "invited") {
      return { kind: "error", code: "not_found", message: "No such link." };
    }

    const authority = (
      await readLinkAuthorities(tx, {
        tenantId: ctx.tenantId,
        userIds: [actorUserId],
      })
    ).get(actorUserId);
    if (!actorCovers(authority, target)) {
      return { kind: "error", code: "not_found", message: "No such link." };
    }

    const signed = signSelfServiceToken({
      tenantId: ctx.tenantId,
      userId: target.userId,
      audience: input.audience,
      subjectId: target.subjectId,
      linkIds: [target.linkId],
    });

    return {
      kind: "ok",
      linkId: target.linkId,
      token: signed.token,
      expiresAt: new Date(signed.claims.exp * 1000),
    };
  });
}

/**
 * PROVISIONS THE LINK ROW THE ACTIVATION CONSUMES.
 *
 * The row is created 'invited' — provisioned, not yet accepted — and the
 * activation flips it to 'active'.
 *
 * THE ACCOUNT IS NAMED EXPLICITLY. The same account may be staff and
 * member/guardian in the same club, and in that case the account's own
 * sign-in number is NOT the club's recorded number for the person, so the
 * account cannot be derived from the member's record. The club picks the
 * account; the recorded number is the club's record of the PERSON.
 *
 * verification_method is 'club_record' only: this product has no
 * delivery channel that could prove possession.
 */
export async function provisionMemberAccountLink(
  ctx: ActionCtx,
  input: {
    audience: LinkAudience;
    accountUserId: string;
    memberId?: string;
    guardianshipId?: string;
  },
): Promise<ProvisionResult> {
  return withTenant(ctx.tenantId, (tx) => provisionMemberAccountLinkInTx(tx, ctx, input));
}

export async function provisionMemberAccountLinkInTx(
  tx: TenantTx,
  ctx: ActionCtx,
  input: { audience: LinkAudience; accountUserId: string; memberId?: string; guardianshipId?: string },
): Promise<ProvisionResult> {
  const actorUserId = ctx.userId;
  if (!actorUserId) return { kind: "error", code: "not_found", message: "No such link." };
  const accountUserId = asUserId(input.accountUserId);
    const authority = (
      await readLinkAuthorities(tx, {
        tenantId: ctx.tenantId,
        userIds: [actorUserId],
      })
    ).get(actorUserId);
    if (!authority || !authority.live) {
      return { kind: "error", code: "not_found", message: "No such link." };
    }

    if (input.audience === "member") {
      if (!input.memberId) {
        return { kind: "error", code: "not_found", message: "No such member." };
      }
      const memberRows = await tx
        .select({ phone: persons.phone, locationId: members.locationId })
        .from(members)
        .innerJoin(
          persons,
          and(
            eq(persons.id, members.personId),
            eq(persons.tenantId, members.tenantId),
            isNull(persons.deletedAt),
          ),
        )
        .where(
          and(
            eq(members.tenantId, ctx.tenantId),
            eq(members.id, asMemberId(input.memberId)),
            isNull(members.deletedAt),
          ),
        )
        .limit(1)
        .for("share");
      const member = memberRows[0];
      if (!member) {
        return { kind: "error", code: "not_found", message: "No such member." };
      }
      if (
        !authority.unrestricted &&
        (member.locationId === null ||
          !authority.facilityIds.includes(member.locationId))
      ) {
        return { kind: "error", code: "not_found", message: "No such member." };
      }

      const linkId = uuidv7();
      const inserted = await tx
        .insert(memberAccountLinks)
        .values({
          id: linkId,
          tenantId: ctx.tenantId,
          userId: accountUserId,
          memberId: asMemberId(input.memberId),
          status: "invited",
          verificationMethod: "club_record",
          recordedAt: new Date(),
          recordedByUserId: actorUserId,
          recordedPhone: member.phone,
          recordedPhoneAt: member.phone === null ? null : new Date(),
          updatedAt: new Date(),
          updatedBy: actorUserId,
        })
        .onConflictDoNothing()
        .returning({ id: memberAccountLinks.id });
      if (inserted.length === 0) {
        return { kind: "error", code: "not_found", message: "No such member." };
      }

      await writeAudit(tx, {
        tenantId: ctx.tenantId,
        actorType: "user",
        actorId: actorUserId,
        action: "member.account_link.create",
        entityType: "member",
        entityId: input.memberId,
        after: {
          linkId,
          audience: "member",
          status: "invited",
          verificationMethod: "club_record",
        },
        changedFields: ["status"],
        requestId: ctx.requestId ?? null,
      });

      return { kind: "ok", linkId };
    }

    if (!input.guardianshipId || !input.memberId) {
      return { kind: "error", code: "not_found", message: "No such guardianship." };
    }
    const guardianRows = await tx
      .select({ phone: persons.phone, locationId: members.locationId })
      .from(guardianships)
      .innerJoin(members, and(
        eq(members.tenantId, guardianships.tenantId),
        eq(members.personId, guardianships.minorId),
        eq(members.id, asMemberId(input.memberId)),
        isNull(members.deletedAt),
      ))
      .innerJoin(
        persons,
        and(
          eq(persons.id, guardianships.guardianId),
          eq(persons.tenantId, guardianships.tenantId),
          isNull(persons.deletedAt),
        ),
      )
      .where(
        and(
          eq(guardianships.tenantId, ctx.tenantId),
          eq(guardianships.id, input.guardianshipId),
          isNull(guardianships.deletedAt),
        ),
      )
      .limit(1)
        .for("share");
    const guardian = guardianRows[0];
    if (!guardian) {
      return { kind: "error", code: "not_found", message: "No such guardianship." };
    }

    if (!authority.unrestricted && !authority.facilityIds.includes(guardian.locationId)) {
      return { kind: "error", code: "not_found", message: "No such guardianship." };
    }

    const linkId = uuidv7();
    const inserted = await tx
      .insert(guardianChildLinks)
      .values({
        id: linkId,
        tenantId: ctx.tenantId,
        userId: accountUserId,
        guardianshipId: input.guardianshipId,
        memberId: asMemberId(input.memberId),
        status: "invited",
        verificationMethod: "club_record",
        recordedAt: new Date(),
        recordedByUserId: actorUserId,
        recordedPhone: guardian.phone,
        recordedPhoneAt: guardian.phone === null ? null : new Date(),
        updatedAt: new Date(),
        updatedBy: actorUserId,
      })
      .onConflictDoNothing()
      .returning({ id: guardianChildLinks.id });
    if (inserted.length === 0) {
      return { kind: "error", code: "not_found", message: "No such guardianship." };
    }

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorType: "user",
      actorId: actorUserId,
      action: "guardian.child_link.create",
      entityType: "guardianship",
      entityId: input.guardianshipId,
      after: {
        linkId,
        audience: "guardian",
        status: "invited",
        verificationMethod: "club_record",
      },
      changedFields: ["status"],
      requestId: ctx.requestId ?? null,
    });

    return { kind: "ok", linkId };
}

