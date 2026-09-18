import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { AnnouncementAudience } from "@/db/schema/announcements";
import { members } from "@/db/schema/people";
import { users } from "@/db/schema/users";
import { tenantMemberships } from "@/db/schema/memberships";
import { guardianships } from "@/db/schema/consent";
import { enrolments } from "@/db/schema/scheduling";
import type { ActionCtx } from "@/lib/auth/context";
import type { UserId } from "@/lib/ids";

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
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
        ),
      );
    for (const row of staff) ids.add(row.userId);
  }

  if (audience === "all" || audience === "batch") {
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
              ),
            );
    for (const row of memberRows) ids.add(row.userId);
  }

  if (audience === "all" || audience === "batch" || audience === "parents") {
    for (const row of await guardianUserRows(
      tx,
      tenantId,
      audience === "batch" ? batchId : undefined,
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
        ),
      );
  }

  return base.where(
    and(
      eq(guardianships.tenantId, tenantId),
      isNull(guardianships.deletedAt),
      eq(members.status, "active"),
      isNull(members.deletedAt),
    ),
  );
}
