"use server";

import { requireDefaultCtx } from "@/lib/auth/context";
import { getOwnerDashboard, type OwnerDashboardData } from "@/lib/services/dashboard";

// K3 follow-up: deliberately no assertStaff. The owner dashboard
// reads aggregate operational numbers (active members, today's
// register progress, attendance this week, follow-ups overdue, today's
// lanes). It carries no PII beyond what the calling role's own
// permission set covers, no mutations, and is already confined to
// the caller's tenant by RLS. Accountant is sent here by homePath
// and reaches this surface — role-key gating ("is this person a
// daily floor user") would block them, which is the wrong shape.
// requireDefaultCtx ensures the caller has SOME tenant membership;
// further action-level guards (members.read for the roster, etc.)
// live on the individual report queries the dashboard composes.
export async function getOwnerDashboardAction(): Promise<OwnerDashboardData> {
  const ctx = await requireDefaultCtx();
  return getOwnerDashboard({ tenantId: ctx.tenantId });
}
