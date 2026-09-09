import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { attendance, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { enrolments } from "@/db/schema/scheduling";
import { guardianships } from "@/db/schema/consent";
import { members, persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { coachStaffIdSubquery } from "@/lib/services/staff";
import { asMemberId } from "@/lib/ids";
import { addDays, isMinor, todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";

// Coach-scoped member lookup. The coach can see this member only if
// the member is enrolled in at least one of the coach's batches —
// returns null otherwise so the page renders 404. The shape is a
// narrow subset of what /owner/members/[id] surfaces: phone, medical
// notes, attendance history. DPDP minimum-necessary — a coach needs
// to act at the poolside, not run the academy's data.
//
// Fields intentionally omitted (visible to owner/admin, not coach):
//   - status / status history (lifecycle management)
//   - parent-link issuance, status history (operational data)
//   - consent detail, guardian relationship metadata (DPDP detail)
//   - edit / enrol buttons (coach has no edit surface)
//   - emergency-contact column — there isn't one. persons.phone is
//     the only phone the schema stores; for a minor it often IS the
//     parent's. We also surface guardianships.phone + name for minors
//     so a coach with a hurt nine-year-old can call someone.
export type CoachMemberDetail = {
  memberId: string;
  fullName: string;
  memberCode: string;
  isMinor: boolean;
  dateOfBirth: string | null;
  phone: string | null;
  medicalNotes: string | null;
  batches: string[];
  guardians: Array<{ fullName: string; phone: string | null }>;
  attendance: {
    pct: number | null;
    presentCount: number;
    totalCount: number;
    rows: Array<{
      sessionId: string;
      sessionDate: string;
      batchName: string;
      status: "present" | "absent" | "late";
    }>;
  };
};

export async function getCoachMemberDetail(
  ctx: ActionCtx & { userId: string },
  memberId: string,
): Promise<CoachMemberDetail | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    // First: confirm this member is in at least one of the coach's
    // batches. Coach-scoping mirrors listCoachRoster — the only
    // route to this service. A coach who can somehow pass a member id
    // outside their roster gets null back, which the page renders as
    // 404 (no information leak).
    const rosterHit = await tx
      .select({ memberId: members.id })
      .from(enrolments)
      .innerJoin(members, eq(members.id, enrolments.memberId))
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(members.id, asMemberId(memberId)),
          eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)),
          isNull(members.deletedAt),
          isNull(batches.deletedAt),
        ),
      )
      .limit(1);
    if (rosterHit.length === 0) return null;

    // Member basics. phone here is the member's own row phone, which
    // for adults is usually their own number, and for minors often
    // empty (the parent is the guardian).
    const [base] = await tx
      .select({
        memberId: members.id,
        fullName: persons.fullName,
        memberCode: members.memberCode,
        dateOfBirth: persons.dateOfBirth,
        phone: persons.phone,
        medicalNotes: persons.medicalNotes,
        personId: persons.id,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(eq(members.id, asMemberId(memberId)), eq(members.tenantId, ctx.tenantId)));
    if (!base) return null;

    // Cutoff for the 90-day attendance window is today in the tenant's
    // timezone (sessions.sessionDate is stored in the tenant's local
    // zone), and isMinor follows the same convention as the rest of
    // the codebase. Resolve once, use in both.
    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const timezone = tenantRow?.timezone ?? "UTC";
    const today = todayInZone(timezone);
    const fromDate = addDays(today, -90);

    const minorFlag = base.dateOfBirth ? isMinor(base.dateOfBirth, timezone) : false;

    // Batches coached AND the member is in. Single query; dedup
    // happens via the Set.
    const batchRows = await tx
      .select({ name: batches.name })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(memberId)),
          eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)),
          isNull(batches.deletedAt),
        ),
      );
    const batchesTaught = Array.from(new Set(batchRows.map((r) => r.name))).sort();

    // Guardians — name and phone only, only when the member is a
    // minor. We include both even when phones are null so the page
    // surfaces "no phone on file" honestly rather than hiding the row.
    const guardianRows = minorFlag
      ? await tx
          .select({
            fullName: persons.fullName,
            phone: persons.phone,
          })
          .from(guardianships)
          .innerJoin(persons, eq(persons.id, guardianships.guardianId))
          .where(
            and(
              eq(guardianships.tenantId, ctx.tenantId),
              eq(guardianships.minorId, base.personId),
              isNull(guardianships.deletedAt),
            ),
          )
      : [];

    // Attendance, last 90 days, scoped to the coach's batches. Cutoff
    // resolved above alongside timezone.
    const attRows = await tx
      .select({
        sessionId: sessions.id,
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
        status: attendance.status,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          eq(attendance.memberId, asMemberId(memberId)),
          eq(batches.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)),
          isNull(batches.deletedAt),
          gte(sessions.sessionDate, fromDate),
        ),
      )
      .orderBy(desc(sessions.sessionDate));

    const presentCount = attRows.filter(
      (r) => r.status === "present" || r.status === "late",
    ).length;
    const totalCount = attRows.length;
    const pct = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : null;

    return {
      memberId: base.memberId,
      fullName: base.fullName,
      memberCode: base.memberCode,
      isMinor: minorFlag,
      dateOfBirth: base.dateOfBirth,
      phone: base.phone,
      medicalNotes: base.medicalNotes,
      batches: batchesTaught,
      guardians: guardianRows.map((g) => ({ fullName: g.fullName, phone: g.phone })),
      attendance: {
        pct,
        presentCount,
        totalCount,
        rows: attRows.map((r) => ({
          sessionId: r.sessionId,
          sessionDate: r.sessionDate,
          batchName: r.batchName,
          status: r.status as "present" | "absent" | "late",
        })),
      },
    };
  });
}
