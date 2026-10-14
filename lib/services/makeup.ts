import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { makeupCredits } from "@/db/schema/makeup-credits";
import { attendance, enrolments, sessions } from "@/db/schema/scheduling";
import { batches } from "@/db/schema/programs";
import { tenants } from "@/db/schema/tenants";
import { writeAudit } from "@/lib/audit/write";
import { isUniqueViolation } from "@/lib/pg-errors";
import { todayInZone } from "@/lib/time/tz";
import type { ActionCtx } from "@/lib/auth/context";
import { asMemberId } from "@/lib/ids";
import {
  callerHasPermission,
  callerIsLegacySystem,
  visibleMember,
} from "./resource-access";
import { locationVisible, resolveLocationAccess } from "./location-access";

// Phase R.7 — V.18 makeup sessions. Compensatory entitlement
// from an excused absence, redeemable against another batch
// within a window. One free session per source absence, no
// fee credit, no subscription adjustment (work guide: "do not
// let this drift into a fee credit"). The data model is
// additive — the only "credit" is the makeup_credits row,
// marked granted on excuse and redeemed on the makeup session.
//
// Authority (A02 remediation, 2026-10-10):
//   - Grant is management-only: the service requires
//     programs.write (the action requires the same key). A coach
//     or counter caller can no longer mint a free-session
//     entitlement.
//   - Redemption stays with attendance.mark holders (Reception);
//     the shared visibleMember guard still bounds a coach to
//     their assigned members.
//   - Reads/grants/redemptions all validate the member through
//     visibleMember (owner/admin location-visible, coach
//     assigned-only) before touching credit or session rows.
//   - Grant requires a real `absent` attendance mark on the
//     source session; redemption locks the credit row
//     (`for update`) so two callers serialize.
//   - Grant/redeem write their audit row in the same transaction.
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
//   2. The credit row is pinned to that target session
//      (redeemed_session_id) under a row lock.

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
    if (!(await visibleMember(tx, ctx, memberId))) return [];
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
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await visibleMember(tx, ctx, memberId))) return [];
    return tx
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
      .limit(10);
  });
}

// Upcoming sessions in the member's batches — the redeem targets.
export async function listMakeupTargets(
  ctx: ActionCtx,
  memberId: string,
): Promise<MakeupSessionOption[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    if (!(await visibleMember(tx, ctx, memberId))) return [];
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
        | "forbidden"
        | "member_not_found"
        | "source_session_not_found"
        | "already_has_credit"
        | "source_not_excused"
        | "credit_not_found"
        | "credit_expired"
        | "credit_already_redeemed"
        | "target_session_not_found"
        | "target_session_cancelled"
        | "target_session_in_past"
        | "target_session_not_allowed";
      message: string;
    };

// Grant a credit for a source absence. Management authority
// (programs.write) is required; the source session must be visible to
// the caller and carry a real `absent` attendance mark for that member
// — one credit per excused absence. Legacy internal/system callers
// (no role and no resolved permission set) keep the pre-existing
// service contract; the action layer is their authorization boundary.
//
// The exported entry point translates the concurrent-insert unique
// violation; the transaction body lives in grantMakeupCreditInTx so
// the thrown 23505 can be caught after withTenant() rolls the aborted
// transaction back (the same shape as invoice-mutations' create path).
export async function grantMakeupCredit(
  ctx: ActionCtx,
  input: { memberId: string; sourceSessionId: string; expiresAt?: Date },
): Promise<MakeupCreditResult> {
  try {
    return await grantMakeupCreditInTx(ctx, input);
  } catch (err) {
    // The pre-check loses to a concurrent grant (double submit, two
    // tabs). The unique (tenant, member, source) index aborts the
    // transaction; translate its 23505 into the same already_has_credit
    // result instead of leaking the raw error.
    if (isUniqueViolation(err)) {
      return {
        kind: "error",
        code: "already_has_credit",
        message: "A makeup credit already exists for this source absence.",
      };
    }
    throw err;
  }
}

async function grantMakeupCreditInTx(
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
    const authorized =
      callerIsLegacySystem(ctx) ||
      (await callerHasPermission(tx, ctx, "programs.write"));
    if (!authorized) {
      return {
        kind: "error",
        code: "forbidden",
        message: "Not permitted to grant makeup credits.",
      };
    }

    // The member must be visible under the caller's location/assignment
    // scope before any credit logic runs.
    if (!(await visibleMember(tx, ctx, input.memberId))) {
      return {
        kind: "error",
        code: "member_not_found",
        message: "Member not found.",
      };
    }

    // Confirm the source session is in this tenant and inside the
    // caller's allowed locations.
    const [source] = await tx
      .select({ id: sessions.id, locationId: sessions.locationId })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sourceSessionId),
          eq(sessions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (
      !source ||
      !locationVisible(await resolveLocationAccess(tx, ctx), source.locationId)
    ) {
      return {
        kind: "error",
        code: "source_session_not_found",
        message: "Source session not found.",
      };
    }

    // One credit per excused absence: a real absent mark must exist on
    // the source session. Legacy internal callers predate the
    // attendance-linked grant and keep their contract.
    if (!callerIsLegacySystem(ctx)) {
      const [absent] = await tx
        .select({ id: attendance.id })
        .from(attendance)
        .where(
          and(
            eq(attendance.tenantId, ctx.tenantId),
            eq(attendance.memberId, asMemberId(input.memberId)),
            eq(attendance.sessionId, input.sourceSessionId),
            eq(attendance.status, "absent"),
          ),
        )
        .limit(1);
      if (!absent) {
        return {
          kind: "error",
          code: "source_not_excused",
          message: "No absent mark for this member on the source session.",
        };
      }
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

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: callerIsLegacySystem(ctx) ? null : (ctx.userId ?? null),
      actorType: ctx.userId && !callerIsLegacySystem(ctx) ? "user" : "system",
      action: "makeup.grant",
      entityType: "makeup_credit",
      entityId: row!.id,
      after: {
        memberId: input.memberId,
        sourceSessionId: input.sourceSessionId,
        status: "granted",
        expiresAt: expiresAt.toISOString(),
      },
      requestId: ctx.requestId ?? null,
    });

    return {
      kind: "ok",
      creditId: row!.id,
      memberId: input.memberId,
      sourceSessionId: input.sourceSessionId,
    };
  });
}

// Redeem a credit against a target session. The credit row is locked
// (`select ... for update`) so concurrent redemptions serialize; the
// target session must exist, not be cancelled, and be inside the
// caller's allowed locations. Redemption writes its audit row in the
// same transaction; a refusal writes nothing.
export async function redeemMakeupCredit(
  ctx: ActionCtx,
  input: { memberId: string; sourceSessionId: string; targetSessionId: string },
): Promise<MakeupCreditResult> {
  if (!input.memberId || !input.sourceSessionId || !input.targetSessionId) {
    return {
      kind: "error",
      code: "invalid",
      message: "memberId, sourceSessionId and targetSessionId are required.",
    };
  }

  return withTenant(ctx.tenantId, async (tx) => {
    // Attendance holders (Reception) redeem; the shared member guard
    // below still limits a coach to assigned members. Legacy internal
    // callers keep the pre-existing service contract.
    const authorized =
      callerIsLegacySystem(ctx) ||
      (await callerHasPermission(tx, ctx, "attendance.mark"));
    if (!authorized) {
      return {
        kind: "error",
        code: "forbidden",
        message: "Not permitted to redeem makeup credits.",
      };
    }

    if (!(await visibleMember(tx, ctx, input.memberId))) {
      return {
        kind: "error",
        code: "member_not_found",
        message: "Member not found.",
      };
    }

    // Lock the credit row first: two callers racing the same credit
    // must serialize here, so the second sees the redeemed state.
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
      .limit(1)
      .for("update");
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
    if (c.status === "expired" || c.expiresAt.getTime() < Date.now()) {
      return {
        kind: "error",
        code: "credit_expired",
        message: "Makeup credit has expired.",
      };
    }

    // Validate the target before pinning it: exists, not cancelled,
    // not in the tenant's past, inside the caller's allowed locations.
    const [target] = await tx
      .select({
        id: sessions.id,
        status: sessions.status,
        sessionDate: sessions.sessionDate,
        locationId: sessions.locationId,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.targetSessionId),
          eq(sessions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    if (!target) {
      return {
        kind: "error",
        code: "target_session_not_found",
        message: "Target session not found.",
      };
    }
    if (target.status === "cancelled") {
      return {
        kind: "error",
        code: "target_session_cancelled",
        message: "Target session is cancelled.",
      };
    }
    // A02 hardening — a redemption may only pin a session that has not
    // already happened, judged against the tenant's local day (the same
    // todayInZone resolution listMakeupTargets uses). A past target is
    // refused before the credit row is touched.
    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant?.timezone ?? "Asia/Kolkata");
    if (target.sessionDate < today) {
      return {
        kind: "error",
        code: "target_session_in_past",
        message: "Target session is in the past.",
      };
    }
    if (
      !locationVisible(await resolveLocationAccess(tx, ctx), target.locationId)
    ) {
      return {
        kind: "error",
        code: "target_session_not_allowed",
        message: "Target session is outside your allowed locations.",
      };
    }

    const now = new Date();
    await tx
      .update(makeupCredits)
      .set({
        status: "redeemed",
        redeemedSessionId: input.targetSessionId,
        redeemedAt: now,
        updatedAt: now,
        updatedBy: ctx.userId,
      })
      .where(eq(makeupCredits.id, c.id));

    await writeAudit(tx, {
      tenantId: ctx.tenantId,
      actorId: callerIsLegacySystem(ctx) ? null : (ctx.userId ?? null),
      actorType: ctx.userId && !callerIsLegacySystem(ctx) ? "user" : "system",
      action: "makeup.redeem",
      entityType: "makeup_credit",
      entityId: c.id,
      before: {
        memberId: input.memberId,
        sourceSessionId: input.sourceSessionId,
        status: "granted",
      },
      after: {
        memberId: input.memberId,
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        status: "redeemed",
      },
      requestId: ctx.requestId ?? null,
    });

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
