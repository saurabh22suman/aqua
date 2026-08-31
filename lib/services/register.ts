import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema";
import type { MemberStatus } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import { batches } from "@/db/schema/programs";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import type { ActionCtx } from "@/lib/auth/context";
import { isMinor } from "@/lib/time/tz";
import { createGuardianship, recordConsent, type ConsentGrantInput } from "@/lib/services/consent";
import { coachStaffIdSubquery } from "@/lib/services/staff";
import { asPersonId, asMemberId, type MemberId, type PersonId, type UserId } from "@/lib/ids";

export type GuardianInput =
  | { existingPersonId: string; relationship: string }
  | { fullName: string; phone?: string; relationship: string };

// C-05 (Consent — DPDP), proposed and reviewed before building. A minor
// cannot be created without a guardian and a processing consent grant
// -- checked BEFORE any row is inserted, so a rejection leaves nothing
// behind (drizzle only rolls back on a thrown error, not an early
// return, so every check that can still say no lives above the first
// insert). Minor status is always derived server-side from
// dateOfBirth via isMinor() -- there is no "isMinor" input field for a
// caller to supply or spoof.
export async function createMember(
  ctx: ActionCtx,
  input: {
    fullName: string;
    phone?: string;
    dateOfBirth: string;
    gender?: string;
    locationId: string;
    memberCode: string;
    medicalNotes?: string;
    guardian?: GuardianInput;
    consents: ConsentGrantInput[];
    witnessedByUserId?: UserId;
    // C-14: a trial booking creates the member with status 'trial'
    // instead of the default 'active' -- an initial value, not a
    // transition, so it bypasses transitionMemberStatus's allowed-
    // graph entirely (there is no "from" status on a row that doesn't
    // exist yet).
    initialStatus?: MemberStatus;
  },
): Promise<{ ok: true; memberId: MemberId; personId: PersonId } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const minor = isMinor(input.dateOfBirth, tenant.timezone);

    const processingGrant = input.consents.find((c) => c.purpose === "processing");
    if (!processingGrant) {
      return { ok: false, error: "Processing consent is required to register a member." };
    }
    if (minor && !input.guardian) {
      return { ok: false, error: "A guardian is required to register a minor." };
    }

    // Past this point every check that can still say no has run --
    // nothing has been inserted yet. From here on, any failure (a bad
    // guardian id, a duplicate member code) must THROW, not return, so
    // the transaction rolls back instead of leaving a partial row.
    const [subject] = await tx
      .insert(persons)
      .values({
        tenantId: ctx.tenantId,
        fullName: input.fullName,
        phone: input.phone,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        medicalNotes: input.medicalNotes,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: persons.id });

    let granterId = subject.id;
    let granterName = input.fullName;
    let granterRelationship = "self";

    if (minor && input.guardian) {
      if ("existingPersonId" in input.guardian) {
        const [existing] = await tx
          .select({ id: persons.id, fullName: persons.fullName })
          .from(persons)
          .where(and(eq(persons.id, asPersonId(input.guardian.existingPersonId)), eq(persons.tenantId, ctx.tenantId)));
        if (!existing) {
          throw new Error(`createMember: guardian ${input.guardian.existingPersonId} not found in this tenant`);
        }
        granterId = existing.id;
        granterName = existing.fullName;
      } else {
        const [guardianPerson] = await tx
          .insert(persons)
          .values({
            tenantId: ctx.tenantId,
            fullName: input.guardian.fullName,
            phone: input.guardian.phone,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning({ id: persons.id });
        granterId = guardianPerson.id;
        granterName = input.guardian.fullName;
      }
      granterRelationship = input.guardian.relationship;

      await createGuardianship(tx, {
        tenantId: ctx.tenantId,
        minorId: subject.id,
        guardianId: granterId,
        relationship: input.guardian.relationship,
        isPrimary: true,
        createdBy: ctx.userId,
      });
    }

    for (const grant of input.consents) {
      await recordConsent(tx, {
        tenantId: ctx.tenantId,
        personId: subject.id,
        grantedBy: granterId,
        witnessedByUserId: input.witnessedByUserId ?? ctx.userId,
        granterName,
        granterRelationship,
        grant,
      });
    }

    const [member] = await tx
      .insert(members)
      .values({
        tenantId: ctx.tenantId,
        personId: subject.id,
        locationId: input.locationId,
        memberCode: input.memberCode,
        status: input.initialStatus,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: members.id });

    return { ok: true, memberId: member.id, personId: subject.id };
  });
}

// C-18's own done-when: "enrolling beyond capacity is refused with a
// clear message." Previously a raw insert with no check at all -- a
// full batch would silently oversell. Capacity limits distinct
// members in the batch, not enrolment rows: a member already enrolled
// (re-enrolling on a new date, matching the existing upsert-by-day
// semantics below) never counts against capacity a second time.
export async function enrolMember(
  ctx: ActionCtx,
  input: { memberId: string; batchId: string; enrolledOn?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant(ctx.tenantId, async (tx) => {
    // FOR UPDATE: count-then-insert across two round trips is a TOCTOU
    // race — ten concurrent callers can all read the same under-capacity
    // count before any of them commits their insert (reproduced directly:
    // ten concurrent enrolments into a five-capacity batch all succeeded
    // without this lock). Locking the batch row serializes concurrent
    // enrolments into it: the second transaction's read blocks until the
    // first commits, then sees the now-updated count. Same shape as C-31
    // invoice numbering's documented `select ... for update`.
    // isNull(deletedAt): a soft-deleted batch (C-17 completion) reads
    // as "not found", the same as a nonexistent one -- not a distinct
    // error, since a deleted batch isn't a valid enrolment target
    // either way.
    const [batch] = await tx
      .select({ capacity: batches.capacity })
      .from(batches)
      .where(
        and(
          eq(batches.id, input.batchId),
          eq(batches.tenantId, ctx.tenantId),
          isNull(batches.deletedAt),
        ),
      )
      .for("update");
    if (!batch) return { ok: false, error: "Batch not found." };

    const alreadyEnrolled = await tx
      .select({ memberId: enrolments.memberId })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.batchId, input.batchId),
          eq(enrolments.memberId, asMemberId(input.memberId)),
        ),
      )
      .limit(1);

    if (alreadyEnrolled.length === 0) {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(distinct ${enrolments.memberId})::int` })
        .from(enrolments)
        .where(and(eq(enrolments.tenantId, ctx.tenantId), eq(enrolments.batchId, input.batchId)));
      if (n >= batch.capacity) {
        return { ok: false, error: `This batch is full (capacity ${batch.capacity}).` };
      }
    }

    const enrolledOn = input.enrolledOn ?? new Date().toISOString().slice(0, 10);
    await tx.execute(sql`
      insert into enrolments (id, tenant_id, member_id, batch_id, enrolled_on)
      values (${uuidv7()}, ${ctx.tenantId}, ${input.memberId}, ${input.batchId}, ${enrolledOn}::date)
      on conflict (tenant_id, member_id, batch_id, enrolled_on) do nothing
    `);
    return { ok: true };
  });
}

export async function markAttendance(
  ctx: ActionCtx,
  input: { sessionId: string; memberId: string; status: "present" | "absent" | "late"; clientId: string },
): Promise<void> {
  await withTenant(ctx.tenantId, async (tx) => {
    await tx
      .insert(attendance)
      .values({
        tenantId: ctx.tenantId,
        sessionId: input.sessionId,
        memberId: asMemberId(input.memberId),
        status: input.status,
        clientId: input.clientId,
      })
      .onConflictDoUpdate({
        target: [attendance.tenantId, attendance.sessionId, attendance.memberId],
        set: { status: input.status, markedAt: new Date() },
      });
  });
}

export async function countAttendanceForSession(
  ctx: ActionCtx,
  sessionId: string,
): Promise<number> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attendance)
      .where(and(eq(attendance.tenantId, ctx.tenantId), eq(attendance.sessionId, sessionId)));
    return rows[0].n;
  });
}

export type TodaySessionRow = {
  id: string;
  batchName: string;
  startsAt: Date;
  endsAt: Date;
  marked: number;
  total: number;
};

// getTodayAction (lib/actions/coach.ts) showed every session in the
// tenant to any staff member -- a coach could see (and, via
// getRosterAction, mark) another coach's register. A coach only ever
// sees sessions from batches assigned to them; every other staff role
// (owner, admin, receptionist, accountant) keeps full tenant-wide
// visibility -- their job requires oversight across all coaches, a
// coach's does not.
export async function listTodaySessions(
  ctx: ActionCtx & { roleKey: string },
  today: string,
): Promise<TodaySessionRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.tenantId, ctx.tenantId), eq(sessions.sessionDate, today)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)));
    }

    const rows = await tx
      .select({
        id: sessions.id,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        marked: sql<number>`(select count(*)::int from ${attendance} a where a.session_id = ${sessions.id})`,
        total: sql<number>`(select count(*)::int from ${enrolments} e where e.batch_id = ${sessions.batchId} and e.enrolled_on <= ${today} and e.tenant_id = ${ctx.tenantId})`,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(...conditions))
      .orderBy(sessions.startsAt);

    return rows;
  });
}

// Renamed from sessionExistsInTenant: that name was the bug. Tenant
// membership is not the same question as "may this caller see this
// row" -- a coach is a tenant member for every session in the tenant,
// including every other coach's. Same coach-scoping condition as
// listTodaySessions and getRosterForSession, so all three answer
// "which sessions can THIS caller act on" identically rather than
// three independent, driftable checks.
export async function sessionVisibleToCaller(
  ctx: ActionCtx & { roleKey: string },
  sessionId: string,
): Promise<boolean> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)));
    }
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  });
}

export type RosterRow = {
  memberId: string;
  name: string;
  code: string;
  status: "present" | "absent" | "late" | null;
  pct: number | null;
  // C-14 done-when: "a trial appears on the coach's register flagged
  // as a trial." A trial IS a member (status 'trial', bookTrial in
  // lib/services/enquiries.ts) enrolled the same way any other member
  // is -- this is the one place that distinction surfaces to the coach.
  isTrial: boolean;
};

export type RosterData = {
  batchName: string;
  startsAt: Date;
  offlineSyncEnabled: boolean;
  rows: RosterRow[];
};

// getRosterAction (lib/actions/coach.ts) took a session id and only
// checked tenant membership before this fix -- a coach who knew or
// guessed another coach's session id could open (and, through
// markAttendanceSessionAction, mark) that register. Returns null for
// "not visible to this caller" with the SAME shape as "does not
// exist" -- the caller must not be able to tell those two apart,
// which is what makes this a 404, not a 403.
export async function getRosterForSession(
  ctx: ActionCtx & { roleKey: string },
  sessionId: string,
): Promise<RosterData | null> {
  return withTenant(ctx.tenantId, async (tx) => {
    const conditions = [eq(sessions.id, sessionId), eq(sessions.tenantId, ctx.tenantId)];
    if (ctx.roleKey === "coach") {
      conditions.push(eq(sessions.coachId, coachStaffIdSubquery(ctx.tenantId, ctx.userId)));
    }

    const [session] = await tx
      .select({
        id: sessions.id,
        batchName: batches.name,
        startsAt: sessions.startsAt,
        batchId: batches.id,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .where(and(...conditions));
    if (!session) return null;

    const [tenant] = await tx
      .select({ offlineSyncEnabled: tenants.offlineSyncEnabled })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));

    const roster = await tx
      .select({
        memberId: members.id,
        name: persons.fullName,
        code: members.memberCode,
        memberStatus: members.status,
        status: attendance.status,
        presentCount: sql<number>`(
          select count(*)::int from ${attendance} a
          where a.tenant_id = ${ctx.tenantId}
            and a.member_id = ${members.id}
            and a.status in ('present', 'late')
            and a.marked_at >= date_trunc('month', now())
        )`,
        totalCount: sql<number>`(
          select count(*)::int from ${attendance} a
          where a.tenant_id = ${ctx.tenantId}
            and a.member_id = ${members.id}
            and a.marked_at >= date_trunc('month', now())
        )`,
      })
      .from(enrolments)
      .innerJoin(members, eq(members.id, enrolments.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .leftJoin(
        attendance,
        and(eq(attendance.memberId, members.id), eq(attendance.sessionId, sessionId)),
      )
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.batchId, session.batchId),
        ),
      )
      .orderBy(members.memberCode);

    const seen = new Set<string>();
    const rows: RosterRow[] = [];
    for (const r of roster) {
      if (seen.has(r.memberId)) continue;
      seen.add(r.memberId);
      rows.push({
        memberId: r.memberId,
        name: r.name,
        code: r.code,
        status: (r.status as RosterRow["status"]) ?? null,
        pct:
          r.totalCount > 0 ? Math.round((r.presentCount / r.totalCount) * 100) : null,
        isTrial: r.memberStatus === "trial",
      });
    }

    return {
      batchName: session.batchName,
      startsAt: session.startsAt,
      offlineSyncEnabled: tenant.offlineSyncEnabled,
      rows,
    };
  });
}
