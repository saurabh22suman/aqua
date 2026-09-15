import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { subscriptions } from "@/db/schema/subscriptions";
import { membershipPlans } from "@/db/schema/membership-plans";
import { members } from "@/db/schema/people";
import { locations } from "@/db/schema/locations";
import { facilities } from "@/db/schema/preset-engine";
import { tenants } from "@/db/schema/tenants";
import { auditLog } from "@/db/schema/audit";
import { addDays, todayInZone } from "@/lib/time/tz";
import {
  locationPredicate,
  locationVisible,
  resolveLocationAccess,
} from "@/lib/services/location-access";
import { asMemberId } from "@/lib/ids";
import type { ActionCtx } from "@/lib/auth/context";

// C-30 — subscriptions. Start/end, pause/resume, cancel. Pause extends
// the end date by the elapsed paused days on resume. Subscription state
// is independent of the member's own lifecycle status.
//
// ends_on is inclusive (the last covered day): a 30-day plan starting
// 2026-09-14 ends 2026-10-13. A session pack defaults to a 90-day
// validity window; both are overridable at creation.

export const SESSION_PACK_VALIDITY_DAYS = 90;

export type SubscriptionRow = {
  id: string;
  memberId: string;
  planId: string;
  planName: string;
  planKind: string;
  amountPaise: number;
  locationId: string;
  locationName: string;
  activityId: string | null;
  activityName: string | null;
  startsOn: string;
  endsOn: string;
  status: "active" | "paused" | "expired" | "cancelled";
  pausedFrom: string | null;
  pausedUntil: string | null;
  autoRenew: boolean;
  createdAt: string;
};

export type SubscriptionMutationResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-mm-dd date.");

export const createSubscriptionInput = z.object({
  memberId: z.string().uuid(),
  planId: z.string().uuid(),
  startsOn: dateSchema.optional(),
  endsOn: dateSchema.optional(),
  // C-47 — opt-in to the nightly renewal invoice (invoices.generate).
  // No auto-debit exists; the renewal is invoiced, payment stays manual.
  autoRenew: z.boolean().optional(),
});

export const pauseSubscriptionInput = z.object({
  id: z.string().uuid(),
  pausedUntil: dateSchema.optional(),
});

export const subscriptionIdInput = z.object({ id: z.string().uuid() });

// Whole days between two yyyy-mm-dd dates (UTC, date arithmetic only).
export function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

export async function listMemberSubscriptions(
  ctx: ActionCtx,
  memberId: string,
): Promise<SubscriptionRow[]> {
  return withTenant(ctx.tenantId, async (tx) => {
    // O-08 — scoped callers only read subscriptions at their own
    // facilities (the subscription carries the plan's facility).
    const access = await resolveLocationAccess(tx, ctx);
    const conditions = [
      eq(subscriptions.tenantId, ctx.tenantId),
      eq(subscriptions.memberId, asMemberId(memberId)),
    ];
    const accessPredicate = locationPredicate(subscriptions.locationId, access);
    if (accessPredicate) conditions.push(accessPredicate);

    const rows = await tx
      .select({
        subscription: subscriptions,
        planName: membershipPlans.name,
        planKind: membershipPlans.kind,
        amountPaise: membershipPlans.amountPaise,
        locationName: locations.name,
        activityName: facilities.name,
      })
      .from(subscriptions)
      .innerJoin(
        membershipPlans,
        and(
          eq(membershipPlans.id, subscriptions.planId),
          eq(membershipPlans.tenantId, ctx.tenantId),
        ),
      )
      .innerJoin(locations, eq(locations.id, subscriptions.locationId))
      .leftJoin(
        facilities,
        and(
          eq(facilities.id, subscriptions.activityId),
          eq(facilities.tenantId, ctx.tenantId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(subscriptions.startsOn));
    return rows.map(
      ({ subscription, planName, planKind, amountPaise, locationName, activityName }) => ({
        id: subscription.id,
        memberId: subscription.memberId,
        planId: subscription.planId,
        planName,
        planKind,
        amountPaise: Number(amountPaise),
        locationId: subscription.locationId,
        locationName,
        activityId: subscription.activityId,
        activityName,
        startsOn: subscription.startsOn,
        endsOn: subscription.endsOn,
        status: subscription.status as SubscriptionRow["status"],
        pausedFrom: subscription.pausedFrom,
        pausedUntil: subscription.pausedUntil,
        autoRenew: subscription.autoRenew,
        createdAt: subscription.createdAt.toISOString(),
      }),
    );
  });
}

export async function createSubscription(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = createSubscriptionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid subscription.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const memberRows = await tx
      .select({ id: members.id, locationId: members.locationId })
      .from(members)
      .where(
        and(
          eq(members.id, asMemberId(parsed.data.memberId)),
          eq(members.tenantId, ctx.tenantId),
          isNull(members.deletedAt),
        ),
      )
      .limit(1);
    const member = memberRows[0];
    if (!member) return { ok: false, error: "Member not found." };

    // O-08 — a location-scoped caller cannot start a subscription for
    // a member outside their locations. Same answer as a missing member.
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, member.locationId)) {
      return { ok: false, error: "Member not found." };
    }

    const planRows = await tx
      .select()
      .from(membershipPlans)
      .where(
        and(
          eq(membershipPlans.id, parsed.data.planId),
          eq(membershipPlans.tenantId, ctx.tenantId),
          eq(membershipPlans.isActive, true),
          isNull(membershipPlans.deletedAt),
        ),
      )
      .limit(1);
    const plan = planRows[0];
    if (!plan) return { ok: false, error: "Plan not found or not active." };
    if (plan.kind === "one_time") {
      return {
        ok: false,
        error: "One-time plans are sold through invoices, not subscriptions.",
      };
    }
    // O-08 — the plan's facility must be in the caller's scope too.
    if (!locationVisible(access, plan.locationId)) {
      return { ok: false, error: "Plan not found or not active." };
    }

    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant?.timezone ?? "Asia/Kolkata");
    const startsOn = parsed.data.startsOn ?? today;

    let endsOn: string;
    if (parsed.data.endsOn) {
      endsOn = parsed.data.endsOn;
    } else if (plan.kind === "duration") {
      endsOn = addDays(startsOn, (plan.durationDays ?? 30) - 1);
    } else {
      endsOn = addDays(startsOn, SESSION_PACK_VALIDITY_DAYS - 1);
    }
    if (daysBetween(startsOn, endsOn) < 0) {
      return { ok: false, error: "The end date cannot be before the start." };
    }

    // Bug fix (live-attack audit) — a member can have at most one
    // active subscription to a given plan. This is the clear-UX-message
    // half of the fix; subscriptions_active_member_plan_uidx (a partial
    // unique index) is the concurrency backstop.
    const existingActive = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.tenantId, ctx.tenantId),
          eq(subscriptions.memberId, asMemberId(parsed.data.memberId)),
          eq(subscriptions.planId, plan.id),
          eq(subscriptions.status, "active"),
        ),
      )
      .limit(1);
    if (existingActive[0]) {
      return {
        ok: false,
        error: "This member already has an active subscription to this plan.",
      };
    }

    const [row] = await tx
      .insert(subscriptions)
      .values({
        tenantId: ctx.tenantId,
        memberId: asMemberId(parsed.data.memberId),
        planId: plan.id,
        locationId: plan.locationId,
        activityId: plan.activityId,
        startsOn,
        endsOn,
        status: "active",
        autoRenew: parsed.data.autoRenew ?? false,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning({ id: subscriptions.id });
    if (!row) return { ok: false, error: "The subscription could not be saved." };

    await writeAudit(tx, ctx, "subscription.create", row.id, {
      planId: plan.id,
      planName: plan.name,
      locationId: plan.locationId,
      activityId: plan.activityId,
      startsOn,
      endsOn,
      autoRenew: parsed.data.autoRenew ?? false,
    });
    return { ok: true, id: row.id };
  });
}

export async function pauseSubscription(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = pauseSubscriptionInput.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid pause.",
    };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        locationId: subscriptions.locationId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const subscription = rows[0];
    if (!subscription) return { ok: false, error: "Subscription not found." };
    // O-08 — another facility's subscription is not found.
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, subscription.locationId)) {
      return { ok: false, error: "Subscription not found." };
    }
    if (subscription.status !== "active") {
      return { ok: false, error: "Only an active subscription can be paused." };
    }

    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant?.timezone ?? "Asia/Kolkata");
    if (parsed.data.pausedUntil && daysBetween(today, parsed.data.pausedUntil) < 0) {
      return { ok: false, error: "The pause end date cannot be in the past." };
    }

    await tx
      .update(subscriptions)
      .set({
        status: "paused",
        pausedFrom: today,
        pausedUntil: parsed.data.pausedUntil ?? null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      );
    await writeAudit(tx, ctx, "subscription.pause", parsed.data.id, {
      pausedFrom: today,
      pausedUntil: parsed.data.pausedUntil ?? null,
    });
    return { ok: true, id: parsed.data.id };
  });
}

export async function resumeSubscription(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = subscriptionIdInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid subscription reference." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        endsOn: subscriptions.endsOn,
        pausedFrom: subscriptions.pausedFrom,
        locationId: subscriptions.locationId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const subscription = rows[0];
    if (!subscription) return { ok: false, error: "Subscription not found." };
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, subscription.locationId)) {
      return { ok: false, error: "Subscription not found." };
    }
    if (subscription.status !== "paused" || !subscription.pausedFrom) {
      return { ok: false, error: "Only a paused subscription can be resumed." };
    }

    const [tenant] = await tx
      .select({ timezone: tenants.timezone })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId));
    const today = todayInZone(tenant?.timezone ?? "Asia/Kolkata");
    const pausedDays = Math.max(0, daysBetween(subscription.pausedFrom, today));
    const extendedEndsOn = addDays(subscription.endsOn, pausedDays);

    await tx
      .update(subscriptions)
      .set({
        status: "active",
        endsOn: extendedEndsOn,
        pausedFrom: null,
        pausedUntil: null,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      );
    await writeAudit(tx, ctx, "subscription.resume", parsed.data.id, {
      pausedDays,
      endsOn: extendedEndsOn,
    });
    return { ok: true, id: parsed.data.id };
  });
}

export async function cancelSubscription(
  ctx: ActionCtx,
  raw: unknown,
): Promise<SubscriptionMutationResult> {
  const parsed = subscriptionIdInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid subscription reference." };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        locationId: subscriptions.locationId,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      )
      .limit(1);
    const subscription = rows[0];
    if (!subscription) return { ok: false, error: "Subscription not found." };
    const access = await resolveLocationAccess(tx, ctx);
    if (!locationVisible(access, subscription.locationId)) {
      return { ok: false, error: "Subscription not found." };
    }
    if (subscription.status === "cancelled") {
      return { ok: false, error: "This subscription is already cancelled." };
    }

    await tx
      .update(subscriptions)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(
        and(
          eq(subscriptions.id, parsed.data.id),
          eq(subscriptions.tenantId, ctx.tenantId),
        ),
      );
    await writeAudit(tx, ctx, "subscription.cancel", parsed.data.id, {});
    return { ok: true, id: parsed.data.id };
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

async function writeAudit(
  tx: Tx,
  ctx: ActionCtx,
  action: string,
  entityId: string,
  after: Record<string, unknown>,
): Promise<void> {
  if (!ctx.userId) return;
  await tx.insert(auditLog).values({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    action,
    entityType: "subscription",
    entityId,
    after,
  });
}
