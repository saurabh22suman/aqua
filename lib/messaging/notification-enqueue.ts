import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import type { AuditActorType, AuditSource } from "@/db/schema/audit";
import { whatsappNotificationOutbox as outbox } from "@/db/schema/whatsapp";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import { roles } from "@/db/schema/roles";
import { memberNotificationContacts } from "@/lib/services/notification-destinations";
import { writeAudit } from "@/lib/audit/write";
import { normaliseToE164 } from "@/lib/phone";
import { asMemberId, type TenantId } from "@/lib/ids";

export type NotificationEvent = {
  tenantId: TenantId;
  eventKey: string;
  body: string;
  essential?: boolean;
  audience?: "selected" | "guardians";
  // Who the queued audit row is attributed to. A background job has no
  // human actor (actor_type 'system', actor_id NULL, source 'job'); a
  // request path names the acting user. When it is not supplied the row
  // keeps today's shape ('user', no actor id, 'web') — the request-path
  // call sites in other lanes (payments, invoice issue, announcements,
  // session lifecycle, invitations) rely on that until they pass their
  // own actor, which is a cross-lane interface change and is proposed,
  // not applied here.
  actor?: { actorType: AuditActorType; actorId: string | null; source: AuditSource };
};

export async function memberNotificationTargets(tx: TenantTx, event: Pick<NotificationEvent, "tenantId" | "essential" | "audience">, memberId: string) {
  const result = await memberNotificationContacts(tx, event.tenantId, memberId);
  if (!result || result.member.status === "left" || (!event.essential && !result.communicationsAllowed)) return [];
  const targets: Array<{ personId: string; phone: string }> = [];
  const phones = new Set<string>();
  for (const contact of result.contacts) {
    // Fee receipts concern guardians' contractual obligations. For minors,
    // never redirect these to the child's own phone merely via preferences.
    if (!contact.selected || phones.has(contact.phone) ||
      ((event.audience === "guardians" || (event.essential && result.minor)) && contact.personId === result.member.personId)) continue;
    phones.add(contact.phone);
    targets.push({ personId: contact.personId, phone: contact.phone });
  }
  return targets;
}

export async function enqueueMemberNotification(tx: TenantTx, event: NotificationEvent, memberId: string) {
  const targets = await memberNotificationTargets(tx, event, memberId);
  return enqueueResolvedMemberNotification(tx, event, memberId, targets);
}

export async function enqueueResolvedMemberNotification(tx: TenantTx, event: NotificationEvent, memberId: string,
  targets: Awaited<ReturnType<typeof memberNotificationTargets>>) {
  let count = 0;
  for (const contact of targets) {
    const [row] = await tx.insert(outbox).values({ tenantId: event.tenantId, eventKey: event.eventKey,
      memberId: asMemberId(memberId), recipientPersonId: contact.personId as never,
      phone: contact.phone, body: event.body, essential: event.essential ?? false, audience: event.audience ?? "selected" })
      .onConflictDoNothing().returning({ id: outbox.id });
    if (row) { count++; await queuedAudit(tx, event, row.id); }
  }
  return count;
}

export async function staffAudienceCandidates(tx: TenantTx, event: Pick<NotificationEvent, "tenantId">,
  scope: { locationId?: string | null; coachUserId?: string | null; allStaff?: boolean; batchId?: string; sessionId?: string } = {}) {
  const staffRows = await tx.select({ userId: users.id, phone: users.phone, role: roles.key,
    membershipId: tenantMemberships.id, allLocations: tenantMemberships.allLocations })
    .from(tenantMemberships).innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, event.tenantId)))
    .where(and(eq(tenantMemberships.tenantId, event.tenantId), eq(tenantMemberships.status, "active"),
      isNull(tenantMemberships.deletedAt), isNull(users.deletedAt), isNull(roles.deletedAt), inArray(roles.key, ["owner", "coach", "receptionist", "worker", "manager", "accountant"])));
  const targets: Array<{ userId: typeof users.$inferSelect.id; role: string; phone: string }> = [];
  for (const staff of staffRows) {
    if (!scope.allStaff && staff.role === "coach" && staff.userId !== scope.coachUserId) continue;
    if (scope.batchId && scope.locationId == null && !staff.allLocations) continue;
    if (scope.locationId && !staff.allLocations) {
      const [location] = await tx.select({ id: membershipLocations.locationId }).from(membershipLocations)
        .where(and(eq(membershipLocations.membershipId, staff.membershipId), eq(membershipLocations.locationId, scope.locationId))).limit(1);
      if (!location) continue;
    }
    targets.push({ userId: staff.userId, role: staff.role, phone: staff.phone });
  }
  return targets;
}

export async function staffNotificationTargets(tx: TenantTx, event: Pick<NotificationEvent, "tenantId">,
  scope: { locationId?: string | null; coachUserId?: string | null; allStaff?: boolean; batchId?: string; sessionId?: string } = {}) {
  const seen = new Set<string>();
  return (await staffAudienceCandidates(tx, event, scope)).flatMap((staff) => {
    const phone = normaliseToE164(staff.phone);
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || seen.has(phone)) return [];
    seen.add(phone);
    return [{ ...staff, phone }];
  });
}

export async function enqueueStaffNotification(tx: TenantTx, event: NotificationEvent,
  scope: { locationId?: string | null; coachUserId?: string | null; allStaff?: boolean; batchId?: string; sessionId?: string } = {}) {
  const targets = await staffNotificationTargets(tx, event, scope);
  return enqueueResolvedStaffNotification(tx, event, scope, targets);
}

export async function enqueueResolvedStaffNotification(tx: TenantTx, event: NotificationEvent,
  scope: { locationId?: string | null; coachUserId?: string | null; allStaff?: boolean; batchId?: string; sessionId?: string },
  targets: Awaited<ReturnType<typeof staffNotificationTargets>>) {
  let count = 0;
  for (const staff of targets) {
    const phone = staff.phone;
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
  // The actor the queued row is attributed to. The default is the
  // historical shape; a job passes its own (system / job), so a
  // background action is never recorded as a web user who does not
  // exist.
  const actor = event.actor ?? { actorType: "user" as const, actorId: null, source: "web" as const };
  await writeAudit(tx, { tenantId: event.tenantId, actorType: actor.actorType, actorId: actor.actorId,
    source: actor.source, action: "whatsapp.notification.queued",
    entityType: "whatsapp_notification", entityId: id, after: { eventKey: event.eventKey } });
}

// PostgreSQL advisory locks in dispatch serialize consumers for one tenant.
export async function notificationDispatchLock(tx: TenantTx, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`whatsapp-dispatch:${tenantId}`}))`);
}
