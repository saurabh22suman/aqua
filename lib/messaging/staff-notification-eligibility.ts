import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { tenantMemberships, membershipLocations } from "@/db/schema/memberships";
import { users } from "@/db/schema/users";
import { roles } from "@/db/schema/roles";
import { staff } from "@/db/schema/staff";
import { batches } from "@/db/schema/programs";
import { sessions } from "@/db/schema/scheduling";
import { whatsappNotificationOutbox } from "@/db/schema/whatsapp";
import { normaliseToE164 } from "@/lib/phone";
import type { StaffId } from "@/lib/ids";

export async function staffNotificationAllowed(tx: TenantTx, row: typeof whatsappNotificationOutbox.$inferSelect): Promise<boolean> {
  if (!row.recipientUserId) return false;
  const invitation = row.eventKey.startsWith("login_link:") ? row.eventKey.split(":")[1] : null;
  if (!invitation && !row.recipientRole) return false;
  const memberships = await tx.select({ id: tenantMemberships.id, phone: users.phone,
    allLocations: tenantMemberships.allLocations, role: roles.key }).from(tenantMemberships)
    .innerJoin(users, eq(users.id, tenantMemberships.userId))
    .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, row.tenantId)))
    .where(and(eq(tenantMemberships.tenantId, row.tenantId), eq(tenantMemberships.userId, row.recipientUserId),
      invitation ? eq(tenantMemberships.id, invitation) : eq(roles.key, row.recipientRole!),
      inArray(tenantMemberships.status, invitation ? ["invited", "active"] : ["active"]), isNull(tenantMemberships.deletedAt)));
  for (const membership of memberships) {
    if (normaliseToE164(membership.phone) !== row.phone) continue;
    if (invitation) return true;
    let locationId = row.scopeLocationId;
    let coachId: StaffId | null = null;
    if (row.scopeSessionId) {
      const [session] = await tx.select({ locationId: sessions.locationId, coachId: sessions.coachId }).from(sessions)
        .where(and(eq(sessions.id, row.scopeSessionId), eq(sessions.tenantId, row.tenantId))).limit(1);
      if (!session) continue;
      locationId = session.locationId; coachId = session.coachId;
    } else if (row.scopeBatchId) {
      const [batch] = await tx.select({ locationId: batches.locationId, coachId: batches.coachId }).from(batches)
        .where(and(eq(batches.id, row.scopeBatchId), eq(batches.tenantId, row.tenantId), isNull(batches.deletedAt))).limit(1);
      if (!batch) continue;
      locationId = batch.locationId; coachId = batch.coachId;
    }
    if (locationId && !membership.allLocations) {
      const [site] = await tx.select({ id: membershipLocations.id }).from(membershipLocations).where(and(
        eq(membershipLocations.tenantId, row.tenantId), eq(membershipLocations.membershipId, membership.id),
        eq(membershipLocations.locationId, locationId))).limit(1);
      if (!site) continue;
    }
    if (membership.role === "coach" && (row.scopeSessionId || row.scopeBatchId)) {
      if (!coachId) continue;
      const [coach] = await tx.select({ id: staff.id }).from(staff).where(and(eq(staff.id, coachId),
        eq(staff.tenantId, row.tenantId), eq(staff.userId, row.recipientUserId), isNull(staff.deletedAt))).limit(1);
      if (!coach) continue;
    }
    return true;
  }
  return false;
}
