import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { tenantMemberships } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import { tenants } from "@/db/schema/tenants";
import { whatsappNotificationOutbox } from "@/db/schema/whatsapp";
import { signInviteLinkToken, INVITE_LINK_TTL_SECONDS, RELOGIN_LINK_TTL_SECONDS } from "@/lib/services/invite-link-token";
import { writeAudit } from "@/lib/audit/write";
import { env } from "@/lib/env";
import type { TenantId } from "@/lib/ids";

export async function enqueueInvitationNotification(
  tx: TenantTx,
  tenantId: TenantId,
  membershipId: string,
): Promise<boolean> {
  const [membership] = await tx.select({ userId: users.id, phone: users.phone, status: tenantMemberships.status,
    tenantName: tenants.name }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId)).innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.id, membershipId),
      isNull(tenantMemberships.deletedAt))).limit(1);
  if (!membership || !["invited", "active"].includes(membership.status)) return false;
  const purpose = membership.status === "invited" ? "invite" : "relogin";
  const { token, claims } = signInviteLinkToken({ tenantId, membershipId, purpose,
    ttlSeconds: purpose === "invite" ? INVITE_LINK_TTL_SECONDS : RELOGIN_LINK_TTL_SECONDS });
  const url = new URL(`/login/link/${token}`, env.BETTER_AUTH_URL ?? "http://localhost:3000").href;
  const [row] = await tx.insert(whatsappNotificationOutbox).values({ tenantId,
    eventKey: `login_link:${membershipId}:${claims.jti}`, recipientUserId: membership.userId,
    phone: membership.phone, essential: true,
    body: `${membership.tenantName}: your private Aqua ${purpose === "invite" ? "invitation" : "sign-in"} link is ${url}. Do not forward it.` })
    .returning({ id: whatsappNotificationOutbox.id });
  if (!row) return false;
  await writeAudit(tx, { tenantId, actorId: null, action: "whatsapp.invitation.queued",
    entityType: "whatsapp_notification", entityId: row.id, after: { membershipId, purpose } });
  // The caller may ignore the result. A caller that needs the notification
  // to exist (an issuance that must not commit without it) requires `true`:
  // it is returned only after BOTH the outbox row and its audit row are
  // written, in the caller's transaction. A failed audit write rejects
  // instead of returning true, so the caller's transaction rolls back.
  return true;
}
