import { eq } from "drizzle-orm";
import { currentOpsActorId, currentOpsScope, OpsForbiddenError, recordOpsAudit } from "./ops-action";
import { platformUsers } from "./schema/platform-users";
import type { TenantTx } from "./tenant";
import type { TenantId } from "@/lib/ids";
import { writeAudit } from "@/lib/audit/write";
import type { InviteLinkPurpose } from "./schema/invite-link-uses";

/** Called inside the issuance transaction, before returning a bearer credential. */
export async function auditOpsCredential(
  tx: TenantTx,
  tenantId: TenantId,
  membershipId: string,
  purpose: InviteLinkPurpose,
  expiresAt: Date,
): Promise<void> {
  const actorId = currentOpsActorId();
  if (!actorId) return; // Tenant issuers retain their existing audit path.
  const action = purpose === "reset"
    ? "tenant.owner_reset_link.issue" : "tenant.owner_login_link.issue";
  if (currentOpsScope() !== action) throw new OpsForbiddenError();
  // Recheck and lock the operator in the same transaction as issuance/audit.
  const [actor] = await tx.select({ role: platformUsers.role, status: platformUsers.status })
    .from(platformUsers).where(eq(platformUsers.id, actorId)).for("share");
  if (actor?.role !== "admin" || actor.status !== "active") throw new OpsForbiddenError();
  const detail = { purpose, expiresAt: expiresAt.toISOString() };
  await writeAudit(tx, {
    tenantId, actorType: "platform", actorId: null, source: "ops", action,
    entityType: "tenant_membership", entityId: membershipId,
    after: { ...detail, platformActorId: actorId },
  });
  await recordOpsAudit(tx, {
    action, tenantId, targetType: "tenant_membership", targetId: membershipId, detail,
  });
}
