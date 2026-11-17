import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { roles } from "@/db/schema/roles";
import { tenantMemberships } from "@/db/schema/memberships";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";

// A06 — issuer-target trust on credential issuance. `homeOrdinal` is
// the tenant role's trust rank (owner=0, admin=1, coach=2,
// curriculum_lead=2, receptionist/accountant/worker=3). An issuer may
// only mint a bearer credential for a target at or below its own rank:
// Owner -> Owner (co-owner recovery) and Admin -> lower-trust staff
// stay allowed, Admin -> Owner is refused. The rank is read from the
// tenant's role rows, never from a caller-supplied label.
async function issuerHomeOrdinal(
  tx: TenantTx,
  tenantId: TenantId,
  issuer: ActionCtx | null | undefined,
): Promise<number | null> {
  if (!issuer) return null;
  if (issuer.roleKey) {
    const [row] = await tx
      .select({ homeOrdinal: roles.homeOrdinal })
      .from(roles)
      .where(
        and(
          eq(roles.tenantId, tenantId),
          eq(roles.key, issuer.roleKey),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    return row?.homeOrdinal ?? null;
  }
  if (!issuer.userId) return null;
  const [row] = await tx
    .select({ homeOrdinal: roles.homeOrdinal })
    .from(tenantMemberships)
    .innerJoin(
      roles,
      and(
        eq(roles.id, tenantMemberships.roleId),
        eq(roles.tenantId, tenantMemberships.tenantId),
      ),
    )
    .where(
      and(
        eq(tenantMemberships.tenantId, tenantId),
        eq(tenantMemberships.userId, issuer.userId),
        eq(tenantMemberships.status, "active"),
        isNull(tenantMemberships.deletedAt),
        isNull(roles.deletedAt),
      ),
    )
    .limit(1);
  return row?.homeOrdinal ?? null;
}

// Unknown issuer ranks fail closed: a caller with no resolvable active
// membership or role cannot mint credentials.
export async function trustGateDenies(
  tx: TenantTx,
  tenantId: TenantId,
  issuer: ActionCtx | null | undefined,
  targetOrdinal: number,
): Promise<boolean> {
  if (!issuer) return false;
  const issuerOrdinal = await issuerHomeOrdinal(tx, tenantId, issuer);
  return issuerOrdinal === null || targetOrdinal < issuerOrdinal;
}
