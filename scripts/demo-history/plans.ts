import { historyId } from "./keys";
import type { TenantState } from "./snapshot";
import type { SnapshotPlan } from "./types";

// Which plans the demo tenant sells.
//
// The preset ships two templates (Monthly / Quarterly) with NO price —
// architecture §7.4 is explicit that a seeded price becomes a billing
// dispute the day the club invoices its first swimmer. So the generator
// prices the templates itself, at demo prices, and records them as the
// tenant's own plans. The prices are constants of the DEMO, not of the
// product: change them here and the whole history follows.

export const DEMO_PLAN_PRICES: Array<{
  name: string;
  shapeName: string | null;
  kind: "duration" | "term";
  durationDays: number;
  amountPaise: number;
}> = [
  {
    name: "Monthly Membership",
    shapeName: "Monthly",
    kind: "duration",
    durationDays: 30,
    amountPaise: 450_000, // ₹4,500
  },
  {
    name: "Quarterly Membership",
    shapeName: "Quarterly",
    kind: "duration",
    durationDays: 90,
    amountPaise: 1_200_000, // ₹12,000
  },
  {
    name: "Annual Membership",
    shapeName: null,
    kind: "term",
    durationDays: 365,
    amountPaise: 4_500_000, // ₹45,000
  },
];

/**
 * The effective plan set for the tenant: the plans it already sells,
 * plus the demo plans it still needs. Existing plans win — the
 * generator never re-prices a plan the operator already set up.
 */
export function resolveDemoPlans(state: TenantState): SnapshotPlan[] {
  const byDuration = new Map<number, SnapshotPlan>();
  for (const plan of state.plans) {
    if (plan.durationDays && !byDuration.has(plan.durationDays)) {
      byDuration.set(plan.durationDays, plan);
    }
  }

  const shapeByName = new Map(state.planShapes.map((shape) => [shape.name, shape]));
  const resolved: SnapshotPlan[] = [];

  for (const demo of DEMO_PLAN_PRICES) {
    const existing = byDuration.get(demo.durationDays);
    if (existing) {
      resolved.push(existing);
      continue;
    }
    const shape = demo.shapeName ? shapeByName.get(demo.shapeName) : undefined;
    resolved.push({
      id: historyId(state.tenant.id, "plan", demo.name),
      name: demo.name,
      amountPaise: demo.amountPaise,
      durationDays: demo.durationDays,
      kind: demo.kind,
      sourceShapeId: shape?.id ?? null,
      locationId: state.primaryLocationId,
      activityId: state.facilityId,
      proposed: true,
    });
  }

  // Any plan the tenant already sells that the demo set does not cover
  // (a bespoke price the operator entered) still belongs in the
  // snapshot — the planner may use it.
  for (const plan of state.plans) {
    if (!resolved.some((entry) => entry.id === plan.id)) {
      resolved.push({ ...plan, proposed: false });
    }
  }

  return resolved;
}
