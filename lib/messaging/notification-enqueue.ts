import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import { roles } from "@/db/schema/roles";
import { memberNotificationContacts } from "@/lib/services/notification-destinations";
import { writeAudit } from "@/lib/audit/write";
import { normaliseToE164 } from "@/lib/phone";
import { asMemberId, type TenantId } from "@/lib/ids";

export type NotificationEvent = { tenantId: TenantId; eventKey: string; body: string; essential?: boolean; audience?: "selected" | "guardians" };

export async function enqueueMemberNotification(tx: TenantTx, event: NotificationEvent, memberId: string) {
  const result = await memberNotificationContacts(tx, event.tenantId, memberId);
  if (!result || result.member.status === "left" || (!event.essential && !result.communicationsAllowed)) return 0;
  let count = 0;
  const phones = new Set<string>();
  for (const contact of result.contacts) {
    // Fee receipts concern guardians' contractual obligations. For minors,
    // never redirect these to the child's own phone merely via preferences.
    if (!contact.selected || phones.has(contact.phone) ||
      ((event.audience === "guardians" || (event.essential && result.minor)) && contact.personId === result.member.personId)) continue;
    phones.add(contact.phone);
    const [row] = await tx.insert(outbox).values({ tenantId: event.tenantId, eventKey: event.eventKey,
      memberId: asMemberId(memberId), recipientPersonId: contact.personId as never,
      phone: contact.phone, body: event.body, essential: event.essential ?? false, audience: event.audience ?? "selected" })
      .onConflictDoNothing().returning({ id: outbox.id });
    if (row) { count++; await queuedAudit(tx, event, row.id); }
  }
  return count;
}

export async function enqueueStaffNotification(tx: TenantTx, event: NotificationEvent,
  scope: { locationId?: string | null; coachUserId?: string | null; allStaff?: boolean; batchId?: string; sessionId?: string } = {}) {
  const staffRows = await tx.select({ userId: users.id, phone: users.phone, role: roles.key,
    membershipId: tenantMemberships.id, allLocations: tenantMemberships.allLocations })
    .from(tenantMemberships).innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, event.tenantId)))
    .where(and(eq(tenantMemberships.tenantId, event.tenantId), eq(tenantMemberships.status, "active"),
      isNull(tenantMemberships.deletedAt), inArray(roles.key, ["owner", "coach", "receptionist"])));
  const seen = new Set<string>();
  let count = 0;
  for (const staff of staffRows) {
    if (!scope.allStaff && staff.role === "coach" && staff.userId !== scope.coachUserId) continue;
    if (scope.locationId && !staff.allLocations) {
      const [location] = await tx.select({ id: membershipLocations.locationId }).from(membershipLocations)
        .where(and(eq(membershipLocations.membershipId, staff.membershipId), eq(membershipLocations.locationId, scope.locationId))).limit(1);
      if (!location) continue;
    }
    const phone = normaliseToE164(staff.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || seen.has(phone)) continue;
    seen.add(phone);
    const [row] = await tx.insert(outbox).values({ tenantId: event.tenantId, eventKey: event.eventKey,
      recipientUserId: staff.userId, phone, body: event.body, essential: event.essential ?? false,
      recipientRole: staff.role, scopeLocationId: scope.locationId,
      scopeBatchId: scope.batchId, scopeSessionId: scope.sessionId })
      .onConflictDoNothing().returning({ id: outbox.id });
    if (row) { count++; await queuedAudit(tx, event, row.id); }
  }
  return count;
}

async function queuedAudit(tx: TenantTx, event: NotificationEvent, id: string) {
  await writeAudit(tx, { tenantId: event.tenantId, actorId: null, action: "whatsapp.notification.queued",
    entityType: "whatsapp_notification", entityId: id, after: { eventKey: event.eventKey } });
}

// PostgreSQL advisory locks in dispatch serialize consumers for one tenant.
export async function notificationDispatchLock(tx: TenantTx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`whatsapp-dispatch:${tenantId}`}))`);
}
