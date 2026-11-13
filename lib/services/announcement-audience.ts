import { and, eq, exists, isNull, notExists } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { AnnouncementAudience } from "@/db/schema/announcements";
import { members } from "@/db/schema/people";
import { users } from "@/db/schema/users";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { guardianships } from "@/db/schema/consent";
import { enrolments } from "@/db/schema/scheduling";
import type { ActionCtx } from "@/lib/auth/context";
import type { UserId } from "@/lib/ids";
import { guardianChildLinks, memberAccountLinks } from "@/db/schema/member-self";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { authorizeBoundLinks } from "@/lib/services/self-service-session";
import { staffAudienceCandidates } from "@/lib/messaging/notification-enqueue";
import { batches } from "@/db/schema/programs";
import { staff as staffTable } from "@/db/schema/staff";

// U-06 — audience resolution for the announcement fan-out, split out
// of announcements.ts to keep both files inside the line budget.
//
// Resolution rules (Release 1, deliberately simple and documented):
//   * `all`     — every active tenant membership (staff/dashboard
//                 accounts) PLUS every user linked through
//                 users.person_id to an active member or to a
//                 guardian of one.
//   * `batch`   — every user linked to a person enrolled in the
//                 batch, or to a guardian of one.
//   * `parents` — every user linked to a guardian of an active
//                 member.

// Exported for the fan-out tests: the distinct user ids a given
// audience resolves to, before any rows are written.
export async function resolveAudienceUserIds(
  tx: TenantTx,
  tenantId: ActionCtx["tenantId"],
  audience: AnnouncementAudience,
  batchId?: string,
): Promise<UserId[]> {
  const ids = new Set<UserId>();

  if (audience === "all") {
    const staff = await tx
      .selectDistinct({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
      .innerJoin(users, and(eq(users.id, tenantMemberships.userId), isNull(users.deletedAt)))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
        ),
      );
    for (const row of staff) ids.add(row.userId);
  }
  if (audience === "batch" && batchId) {
    const [batch] = await tx.select({ locationId: batches.locationId, coachUserId: staffTable.userId }).from(batches)
      .leftJoin(staffTable, and(eq(staffTable.id, batches.coachId), eq(staffTable.tenantId, tenantId), isNull(staffTable.deletedAt)))
      .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId), isNull(batches.deletedAt))).limit(1);
    if (batch) for (const row of await staffAudienceCandidates(tx, { tenantId }, { locationId: batch.locationId, coachUserId: batch.coachUserId, batchId })) ids.add(row.userId);
  }

  if (audience === "all" || audience === "batch") {
    {
      const linked = await tx.select({ linkId: memberAccountLinks.id, userId: memberAccountLinks.userId, memberId: members.id })
        .from(memberAccountLinks).innerJoin(members, and(eq(members.id, memberAccountLinks.memberId), eq(members.tenantId, tenantId)))
        .where(and(eq(memberAccountLinks.tenantId, tenantId), eq(memberAccountLinks.status, "active"), isNull(memberAccountLinks.revokedAt), eq(members.status, "active"), isNull(members.deletedAt),
          audience === "batch" ? exists(tx.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.tenantId, tenantId), eq(enrolments.memberId, members.id), eq(enrolments.batchId, batchId!)))) : undefined));
      for (const row of linked) {
        const account = await readSelfServiceAccountInTx(tx, { tenantId, userId: row.userId });
        if (!account) continue;
        const authorized = await authorizeBoundLinks(tx, { tenantId, userId: row.userId, audience: "member", linkIds: [row.linkId], accountPhone: account.phone, subjectId: row.memberId });
        if (authorized.ok) ids.add(row.userId);
      }
    }
    // The members themselves (active for `all`, enrolled for `batch`)
    // when they have a linked user account.
    const memberRows =
      audience === "batch"
        ? await tx
            .selectDistinct({ userId: users.id })
            .from(enrolments)
            .innerJoin(
              members,
              and(
                eq(members.id, enrolments.memberId),
                eq(members.tenantId, enrolments.tenantId),
              ),
            )
            .innerJoin(users, eq(users.personId, members.personId))
            .where(
              and(
                eq(enrolments.tenantId, tenantId),
                eq(enrolments.batchId, batchId!),
                isNull(members.deletedAt),
                notExists(tx.select({ id: memberAccountLinks.id }).from(memberAccountLinks).where(and(
                  eq(memberAccountLinks.tenantId, tenantId), eq(memberAccountLinks.userId, users.id), eq(memberAccountLinks.memberId, members.id),
                ))),
              ),
            )
        : await tx
            .selectDistinct({ userId: users.id })
            .from(members)
            .innerJoin(users, eq(users.personId, members.personId))
            .where(
              and(
                eq(members.tenantId, tenantId),
                eq(members.status, "active"),
                isNull(members.deletedAt),
                notExists(tx.select({ id: memberAccountLinks.id }).from(memberAccountLinks).where(and(
                  eq(memberAccountLinks.tenantId, tenantId), eq(memberAccountLinks.userId, users.id), eq(memberAccountLinks.memberId, members.id),
                ))),
              ),
            );
    for (const row of memberRows) ids.add(row.userId);
  }

  if (audience === "all" || audience === "batch" || audience === "parents") {
    {
      const linked = await tx.select({ linkId: guardianChildLinks.id, userId: guardianChildLinks.userId })
        .from(guardianChildLinks).innerJoin(members, and(eq(members.id, guardianChildLinks.memberId), eq(members.tenantId, tenantId)))
        .where(and(eq(guardianChildLinks.tenantId, tenantId), eq(guardianChildLinks.status, "active"), isNull(guardianChildLinks.revokedAt), eq(members.status, "active"), isNull(members.deletedAt),
          audience === "batch" ? exists(tx.select({ id: enrolments.id }).from(enrolments).where(and(eq(enrolments.tenantId, tenantId), eq(enrolments.memberId, members.id), eq(enrolments.batchId, batchId!)))) : undefined));
      for (const row of linked) {
        const account = await readSelfServiceAccountInTx(tx, { tenantId, userId: row.userId });
        if (!account) continue;
        const authorized = await authorizeBoundLinks(tx, { tenantId, userId: row.userId, audience: "guardian", linkIds: [row.linkId], accountPhone: account.phone });
        if (authorized.ok) ids.add(row.userId);
      }
    }
    for (const row of await guardianUserRows(
      tx,
      tenantId,
      audience === "batch" ? batchId : undefined,
      true,
    )) {
      ids.add(row.userId);
    }
  }

  return Array.from(ids);
}

// Users linked to a guardian. For `batch`, only guardians of members
// enrolled in that batch; otherwise guardians of any active member.
async function guardianUserRows(
  tx: TenantTx,
  tenantId: ActionCtx["tenantId"],
  batchId?: string,
  checkExplicitLinks = false,
): Promise<Array<{ userId: UserId }>> {
  const base = tx
    .selectDistinct({ userId: users.id })
    .from(guardianships)
    .innerJoin(
      members,
      and(
        eq(members.personId, guardianships.minorId),
        eq(members.tenantId, guardianships.tenantId),
      ),
    )
    .innerJoin(users, eq(users.personId, guardianships.guardianId));

  if (batchId) {
    return base
      .innerJoin(
        enrolments,
        and(
          eq(enrolments.memberId, members.id),
          eq(enrolments.tenantId, tenantId),
          eq(enrolments.batchId, batchId),
        ),
      )
      .where(
        and(
          eq(guardianships.tenantId, tenantId),
          isNull(guardianships.deletedAt),
          isNull(members.deletedAt),
          checkExplicitLinks ? notExists(tx.select({ id: guardianChildLinks.id }).from(guardianChildLinks).where(and(
            eq(guardianChildLinks.tenantId, tenantId), eq(guardianChildLinks.userId, users.id),
            eq(guardianChildLinks.guardianshipId, guardianships.id),
          ))) : undefined,
        ),
      );
  }

  return base.where(
    and(
      eq(guardianships.tenantId, tenantId),
      isNull(guardianships.deletedAt),
      eq(members.status, "active"),
      isNull(members.deletedAt),
      checkExplicitLinks ? notExists(tx.select({ id: guardianChildLinks.id }).from(guardianChildLinks).where(and(
        eq(guardianChildLinks.tenantId, tenantId), eq(guardianChildLinks.userId, users.id),
        eq(guardianChildLinks.guardianshipId, guardianships.id),
      ))) : undefined,
    ),
  );
}
