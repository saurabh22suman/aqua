import { eq } from "drizzle-orm";
import { membershipPlans } from "@/db/schema/membership-plans";
import { subscriptions } from "@/db/schema/subscriptions";
import { asMemberId } from "@/lib/ids";
import { zonedWallTimeToInstant } from "@/lib/time/tz";
import { historyId } from "./keys";
import { auditInstant } from "./audit-instant";
import type { WriteContext } from "./write-context";

// The membership side: the plans the tenant sells and the
// subscriptions that carry them.
//
// A plan the tenant already has is never re-priced. A plan the
// generator proposes is written with a deterministic id and ON CONFLICT
// DO NOTHING, so a repeat run addresses the same row.
//
// A subscription is one membership cycle. The schema allows at most one
// ACTIVE subscription per member + plan (a partial unique index), which
// is exactly the shape a chain of cycles has: the current cycle is
// active, the earlier ones are expired.

export async function writePlans(ctx: WriteContext): Promise<void> {
  const { tx, tenantId, snapshot, counters, existing, audit } = ctx;
  for (const planRow of snapshot.plans.filter((entry) => entry.proposed)) {
    const rows = await tx
      .insert(membershipPlans)
      .values({
        id: planRow.id,
        tenantId,
        locationId: planRow.locationId,
        activityId: planRow.activityId,
        name: planRow.name,
        kind: planRow.kind,
        durationDays: planRow.durationDays,
        sessions: null,
        amountPaise: BigInt(planRow.amountPaise),
        sourceShapeId: planRow.sourceShapeId,
        isActive: true,
      })
      .onConflictDoNothing()
      .returning({ id: membershipPlans.id });
    if (rows.length === 0) {
      existing.plans += 1;
      continue;
    }
    counters.plans += 1;
    audit.push({
      action: "membership_plan.activate",
      entityType: "membership_plan",
      entityId: planRow.id,
      after: {
        name: planRow.name,
        kind: planRow.kind,
        durationDays: planRow.durationDays,
        amountPaise: planRow.amountPaise,
        locationId: planRow.locationId,
        sourceShapeId: planRow.sourceShapeId,
        synthetic: true,
      },
      createdAt: auditInstant(new Date(ctx.nowMs).toISOString(), ctx.nowMs),
    });
  }
}

export async function writeSubscriptions(ctx: WriteContext): Promise<void> {
  const { tx, tenantId, state, plan, snapshot, counters, existing, audit } = ctx;
  for (const subscription of plan.subscriptions) {
    const planRow = snapshot.plans.find((entry) => entry.id === subscription.planId);
    const rows = await tx
      .insert(subscriptions)
      .values({
        id: historyId(state.tenant.id, "subscription", subscription.key),
        tenantId,
        memberId: asMemberId(subscription.memberId),
        planId: subscription.planId,
        locationId: planRow?.locationId ?? state.primaryLocationId,
        activityId: planRow?.activityId ?? null,
        startsOn: subscription.startsOn,
        endsOn: subscription.endsOn,
        status: subscription.status,
        autoRenew: subscription.autoRenew,
      })
      .onConflictDoNothing()
      .returning({ id: subscriptions.id });
    if (rows.length === 0) {
      existing.subscriptions += 1;
      continue;
    }
    counters.subscriptions += 1;
    audit.push({
      action: "subscription.create",
      entityType: "subscription",
      entityId: rows[0]!.id,
      after: {
        planId: subscription.planId,
        planName: subscription.planName,
        memberId: subscription.memberId,
        startsOn: subscription.startsOn,
        endsOn: subscription.endsOn,
        status: subscription.status,
        autoRenew: subscription.autoRenew,
        synthetic: true,
      },
      createdAt: auditInstant(
        zonedWallTimeToInstant(
          subscription.startsOn,
          "09:00",
          state.tenant.timezone,
        ).toISOString(),
        ctx.nowMs,
      ),
    });
  }
}

/**
 * The real subscription ids, keyed the way the plan keys them. A row
 * the operator already created keeps ITS id, and the invoice must point
 * at that one — not at the id the generator would have used.
 */
export async function resolveSubscriptionIds(
  ctx: WriteContext,
): Promise<Map<string, string>> {
  const rows = await ctx.tx
    .select({
      id: subscriptions.id,
      memberId: subscriptions.memberId,
      planId: subscriptions.planId,
      startsOn: subscriptions.startsOn,
    })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId));
  const byKey = new Map<string, string>();
  for (const row of rows) {
    byKey.set(`${row.memberId}|${row.planId}|${row.startsOn}`, row.id);
  }
  return byKey;
}
