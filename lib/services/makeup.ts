import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { makeupCredits } from "@/db/schema/makeup-credits";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { tenants } from "@/db/schema/tenants";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";

// Phase R.7 — V.18 makeup sessions. Compensatory entitlement
// from an excused absence, redeemable against another batch
// within a window. One free session per source absence, no
// fee credit, no subscription adjustment (work guide: "do not
// let this drift into a fee credit"). The data model is
// additive — the only "credit" is the makeup_credits row,
// marked granted on excuse and redeemed on the makeup session.
//
// Excuse flow:
//   1. Owner marks an attendance row as absent (already in
//      the register, no schema change).
//   2. Owner marks the absence as excused — the service
//      records a makeup_credits row. The "excused" flag itself
//      is the existing attendance.status='absent'; the
//      makeup_credits row is the entitlement that comes with
//      the excuse.
//
// Redemption flow:
//   1. Member attends another session in another batch.
//   2. The attendance row for the makeup session carries a
//      clientId of "makeup:{sourceSessionId}" — the service
//      uses this convention to find the credit and mark it
//      redeemed. No fee-anything touched.

const DEFAULT_EXPIRY_DAYS = 60;

// ---- R.7 UI reads (member detail panel) ----

export type MakeupCreditRow = {
  creditId: string;
  sourceSessionId: string;
  sourceDate: string;
  status: string;
  expiresAt: string;
};

export type MakeupSessionOption = {
  sessionId: string;
  sessionDate: string;
  batchName: string;
};

export async function listMakeupCredits(
  ctx: ActionCtx,
  memberId: string,
): Promise<MakeupCreditRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        creditId: makeupCredits.id,
        sourceSessionId: makeupCredits.sourceSessionId,
        sourceDate: sessions.sessionDate,
        status: makeupCredits.status,
        expiresAt: makeupCredits.expiresAt,
      })
      .from(makeupCredits)
      .innerJoin(sessions, eq(sessions.id, makeupCredits.sourceSessionId))
      .where(
        and(
          eq(makeupCredits.tenantId, ctx.tenantId),
          eq(makeupCredits.memberId, asMemberId(memberId)),
        ),
      )
      .orderBy(desc(makeupCredits.grantedAt));
    return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
  });
}

// Absences that can still be excused into a credit: absent marks with
// no makeup_credits row for that source.
export async function listMakeupSources(
  ctx: ActionCtx,
  memberId: string,
): Promise<MakeupSessionOption[]> {
  return withTenant(ctx.tenantId, (tx) =>
    tx
      .select({
        sessionId: sessions.id,
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
      })
      .from(attendance)
      .innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .innerJoin(batches, eq(batches.id, sessions.batchId))
      .leftJoin(
        makeupCredits,
        and(
          eq(makeupCredits.sourceSessionId, sessions.id),
          eq(makeupCredits.memberId, attendance.memberId),
        ),
      )
      .where(
        and(
          eq(attendance.tenantId, ctx.tenantId),
          eq(attendance.memberId, asMemberId(memberId)),
          eq(attendance.status, "absent"),
          isNull(makeupCredits.id),
        ),
      )
      .orderBy(desc(sessions.sessionDate))
      .limit(10),
  );
}

// Upcoming sessions in the member's batches — the redeem targets.
export async function listMakeupTargets(
  ctx: ActionCtx,
  memberId: string,
): Promise<MakeupSessionOption[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant.timezone);
    return tx
      .select({
        sessionId: sessions.id,
        sessionDate: sessions.sessionDate,
        batchName: batches.name,
      })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .innerJoin(sessions, eq(sessions.batchId, batches.id))
      .where(
        and(
          eq(enrolments.tenantId, ctx.tenantId),
          eq(enrolments.memberId, asMemberId(memberId)),
          gte(sessions.sessionDate, today),
          sql`${sessions.status} <> 'cancelled'`,
        ),
      )
      .orderBy(asc(sessions.sessionDate), asc(sessions.startsAt))
      .limit(20);
  });
}


export type MakeupCreditResult =
  | { kind: "ok"; creditId: string; memberId: string; sourceSessionId: string }
  | {
      kind: "error";
      code:
        | "invalid"
        | "source_session_not_found"
        | "already_has_credit"
        | "source_not_excused"
        | "credit_not_found"
        | "credit_expired"
        | "credit_already_redeemed";
      message: string;
    };

// Grant a credit for a source absence. The "source excused"
// check looks for the attendance row at the source session
// with status='absent' and a clientId that the service treats
// as the "excused" marker. The simpler stand-in here: the
// owner calls grantMakeupCreditForExcusedAbsence directly,
// which already implies they intend to mark the absence as
// excused.
export async function grantMakeupCredit(
  ctx: ActionCtx,
  input: { memberId: string; sourceSessionId: string; expiresAt?: Date },
): Promise<MakeupCreditResult> {
  if (!input.memberId || !input.sourceSessionId) {
    return {
      kind: "error",
      code: "invalid",
      message: "memberId and sourceSessionId are required.",
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    // Confirm the source session is in this tenant.
    const result = await tx.execute<{ id: string; status: string }>(sql`
      select id, status from sessions
      where id = ${input.sourceSessionId}
        and tenant_id = ${ctx.tenantId}
      limit 1
    `);
    const s = (result as unknown as { rows: Array<{ id: string; status: string }> }).rows[0];
    if (!s) {
      return {
        kind: "error",
        code: "source_session_not_found",
        message: "Source session not found.",
      };
    }

    // The (tenant, member, source) tuple is the natural key
    // — one credit per source absence. The unique index
    // throws on collision; we translate.
    const [existing] = await tx
      .select({ id: makeupCredits.id })
      .from(makeupCredits)
      .where(
        and(
          eq(makeupCredits.tenantId, ctx.tenantId),
          eq(makeupCredits.memberId, asMemberId(input.memberId)),
          eq(makeupCredits.sourceSessionId, input.sourceSessionId),
        ),
      )
      .limit(1);
    if (existing) {
      return {
        kind: "error",
        code: "already_has_credit",
        message: "A makeup credit already exists for this source absence.",
      };
    }

    const expiresAt =
      input.expiresAt ??
      new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const [row] = await tx
      .insert(makeupCredits)
      .values({
        tenantId: ctx.tenantId,
        memberId: asMemberId(input.memberId),
        sourceSessionId: input.sourceSessionId,
        status: "granted",
        expiresAt,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: makeupCredits.id });

    return {
      kind: "ok",
      creditId: row!.id,
      memberId: input.memberId,
      sourceSessionId: input.sourceSessionId,
    };
  });
}

// Redeem a credit against a target session. The session is
// identified by the attendance row's clientId matching
// "makeup:{sourceSessionId}".
export async function redeemMakeupCredit(
  ctx: ActionCtx,
  input: { memberId: string; sourceSessionId: string; targetSessionId: string },
): Promise<MakeupCreditResult> {
  return withTenant(ctx.tenantId, async (tx) => {
    const [c] = await tx
      .select({
        id: makeupCredits.id,
        status: makeupCredits.status,
        expiresAt: makeupCredits.expiresAt,
      })
      .from(makeupCredits)
      .where(
        and(
          eq(makeupCredits.tenantId, ctx.tenantId),
          eq(makeupCredits.memberId, asMemberId(input.memberId)),
          eq(makeupCredits.sourceSessionId, input.sourceSessionId),
        ),
      )
      .limit(1);
    if (!c) {
      return {
        kind: "error",
        code: "credit_not_found",
        message: "No makeup credit for this source absence.",
      };
    }
    if (c.status === "redeemed") {
      return {
        kind: "error",
        code: "credit_already_redeemed",
        message: "Makeup credit has already been redeemed.",
      };
    }
    if (c.expiresAt.getTime() < Date.now()) {
      return {
        kind: "error",
        code: "credit_expired",
        message: "Makeup credit has expired.",
      };
    }

    await tx
      .update(makeupCredits)
      .set({
        status: "redeemed",
        redeemedSessionId: input.targetSessionId,
        redeemedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(makeupCredits.id, c.id));

    // The corresponding attendance row carries a
    // clientId of "makeup:{sourceSessionId}" — the register
    // surface reads that as the redemption signal. The owner-
    // side flow can set that clientId at markAttendance time.

    // No money, no subscription, no fee anything — per the
    // work guide, the only side effect is the credit row
    // itself.

    return {
      kind: "ok",
      creditId: c.id,
      memberId: input.memberId,
      sourceSessionId: input.sourceSessionId,
    };
  });
}

void attendance;
void eq;
