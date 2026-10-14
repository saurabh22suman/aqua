import { and, eq, isNull, lte } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { members } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import { staff } from "@/db/schema/staff";
import { enrolments, sessions } from "@/db/schema/scheduling";
import { tenants } from "@/db/schema/tenants";
import type { TenantId } from "@/lib/ids";
import { enqueueMemberNotification, enqueueStaffNotification } from "./notification-enqueue";

export async function enqueueAnnouncementNotifications(tx: TenantTx, input: {
  tenantId: TenantId; announcementId: string; title: string; body: string; audience: string; batchId?: string;
}) {
  const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, input.tenantId));
  const event = { tenantId: input.tenantId, eventKey: `announcement:${input.announcementId}`,
    audience: input.audience === "parents" ? "guardians" as const : "selected" as const,
    body: `${tenant?.name ?? "Aqua"}: ${input.title}\n\n${input.body}` };
  const targets = input.batchId
    ? await tx.selectDistinct({ id: members.id }).from(members).innerJoin(enrolments, and(
      eq(enrolments.memberId, members.id), eq(enrolments.tenantId, input.tenantId), eq(enrolments.batchId, input.batchId)))
      .where(and(eq(members.tenantId, input.tenantId), eq(members.status, "active"), isNull(members.deletedAt)))
    : await tx.select({ id: members.id }).from(members).where(and(eq(members.tenantId, input.tenantId),
      eq(members.status, "active"), isNull(members.deletedAt)));
  let count = 0;
  for (const target of targets) count += await enqueueMemberNotification(tx, event, target.id);
  if (input.audience === "all") count += await enqueueStaffNotification(tx, event, { allStaff: true });
  else if (input.batchId) {
    const [batch] = await tx.select({ locationId: batches.locationId, userId: staff.userId }).from(batches)
      .leftJoin(staff, and(eq(staff.id, batches.coachId), eq(staff.tenantId, input.tenantId), isNull(staff.deletedAt)))
      .where(eq(batches.id, input.batchId)).limit(1);
    if (batch) count += await enqueueStaffNotification(tx, event, { locationId: batch.locationId, coachUserId: batch.userId, batchId: input.batchId });
  }
  return count;
}

export async function enqueueSessionNotification(tx: TenantTx, tenantId: TenantId, sessionId: string, change: "cancelled" | "rescheduled") {
  const [session] = await tx.select({ batchId: sessions.batchId, date: sessions.sessionDate, startsAt: sessions.startsAt,
    locationId: sessions.locationId, coachUserId: staff.userId, batchName: batches.name, updatedAt: sessions.updatedAt })
    .from(sessions).innerJoin(batches, and(eq(batches.id, sessions.batchId), eq(batches.tenantId, tenantId)))
    .leftJoin(staff, and(eq(staff.id, sessions.coachId), eq(staff.tenantId, tenantId), isNull(staff.deletedAt)))
    .where(and(eq(sessions.id, sessionId), eq(sessions.tenantId, tenantId))).limit(1);
  if (!session) return;
  const time = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(session.startsAt);
  const event = { tenantId, eventKey: `session:${sessionId}:${change}:${session.updatedAt.toISOString()}`,
    body: `${session.batchName}: session ${change}. ${change === "cancelled" ? "Original time" : "New time"}: ${time} IST.` };
  const targets = await tx.selectDistinct({ id: members.id }).from(enrolments)
    .innerJoin(members, and(eq(members.id, enrolments.memberId), eq(members.tenantId, tenantId)))
    .where(and(eq(enrolments.tenantId, tenantId), eq(enrolments.batchId, session.batchId),
      lte(enrolments.enrolledOn, session.date), eq(members.status, "active"), isNull(members.deletedAt)));
  for (const target of targets) await enqueueMemberNotification(tx, event, target.id);
  await enqueueStaffNotification(tx, event, { locationId: session.locationId, coachUserId: session.coachUserId, sessionId });
}

export async function enqueueWaitlistPromotion(tx: TenantTx, tenantId: TenantId, batchId: string, memberId: string, entryId: string) {
  const [batch] = await tx.select({ name: batches.name, locationId: batches.locationId, coachUserId: staff.userId })
    .from(batches).leftJoin(staff, and(eq(staff.id, batches.coachId), eq(staff.tenantId, tenantId)))
    .where(and(eq(batches.id, batchId), eq(batches.tenantId, tenantId))).limit(1);
  if (!batch) return;
  const event = { tenantId, eventKey: `waitlist:${entryId}`,
    body: `${batch.name}: your waitlist entry has been promoted. Contact the academy to confirm enrolment; this message does not confirm a booked place.` };
  await enqueueMemberNotification(tx, event, memberId);
  await enqueueStaffNotification(tx, event, { locationId: batch.locationId, coachUserId: batch.coachUserId, batchId });
}
