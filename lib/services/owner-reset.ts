import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { persons } from "@/db/schema/people";
import { writeAudit } from "@/lib/audit/write";
import {
  issueOwnerResetLink,
  type IssueLoginLinkResult,
} from "@/lib/services/invite-link-issue";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";

// PR2-C4 — tenant-side owner recovery. Before this, a locked-out
// owner needed the platform operator to mint a reset link
// (lib/actions/platform-login-link.ts). A co-owner can now do it from
// /owner/staff: list the tenant's active owners, mint the same
// owner-only reset link, and audit the issuance.
//
// The link semantics (owner-only target, 1-hour TTL, session
// revocation on redeem) live in invite-link-issue/invite-link and are
// reused unchanged.

export type OwnerMembershipRow = {
  membershipId: string;
  phone: string;
  fullName: string | null;
};

export async function listOwnerMemberships(
  tenantId: TenantId,
): Promise<OwnerMembershipRow[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({
        membershipId: tenantMemberships.id,
        phone: users.phone,
        fullName: persons.fullName,
      })
      .from(tenantMemberships)
      .innerJoin(users, eq(users.id, tenantMemberships.userId))
      .innerJoin(
        roles,
        and(
          eq(roles.id, tenantMemberships.roleId),
          eq(roles.tenantId, tenantMemberships.tenantId),
        ),
      )
      .leftJoin(
        persons,
        and(
          eq(persons.id, users.personId),
          eq(persons.tenantId, tenantMemberships.tenantId),
        ),
      )
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, "active"),
          eq(roles.key, "owner"),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .orderBy(users.phone);
    return rows.map((row) => ({
      membershipId: row.membershipId,
      phone: row.phone,
      fullName: row.fullName ?? null,
    }));
  });
}

export async function issueTenantOwnerResetLink(
  ctx: ActionCtx,
  membershipId: string,
): Promise<IssueLoginLinkResult> {
  const result = await issueOwnerResetLink(ctx.tenantId, membershipId);
  if (result.kind !== "ok") return result;

  await withTenant(ctx.tenantId, async (tx) => {
    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId ?? null,
      requestId: ctx.requestId ?? null,
      action: "owner.reset_link_issued",
      entityType: "tenant_membership",
      entityId: membershipId,
      after: {
        phone: result.phone,
        expiresAt: result.expiresAt.toISOString(),
      },
    });
  });

  return result;
}
