import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { members } from "@/db/schema/people";
import { batches } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";

// Phase 2.8 — onboarding checklist. The new tenant's owner needs
// to see what's left to set up after the wizard lands them:
// members to add, batches to schedule, coaches to assign. Each
// item is computed from real data — nothing here is stored
// separately — so the checklist can never drift from the actual
// state of the tenant.
//
// The items themselves are fixed in code at this phase; branding
// and terminology land with 2.9/2.10, location-management lands
// with F-23 (Settings). Each new phase that adds a real setup
// step appends its item here. The order is the order a new owner
// would naturally follow.
export type OnboardingItemKey = "add_members" | "create_batch" | "assign_coach";

export type OnboardingItem = {
  key: OnboardingItemKey;
  title: string;
  detail: string;
  cta: { label: string; href: string };
  complete: boolean;
};

export type OnboardingChecklist = {
  items: OnboardingItem[];
  completedCount: number;
  totalCount: number;
};

// "Assign coaches" is the third item. The check is intentionally
// the *narrow* one — a batch actually has a coach assigned, not
// just that a coach-staff row exists somewhere in the system —
// because a present-but-unassigned coach is still work the owner
// has left to do. If `staff` is empty AND no batch has a coach,
// the item is incomplete.
const ITEMS: ReadonlyArray<{
  key: OnboardingItemKey;
  title: string;
  detail: string;
  cta: { label: string; href: string };
}> = [
  {
    key: "add_members",
    title: "Add your first member",
    detail: "The register and history both start with members.",
    cta: { label: "Add a member", href: "/owner/members/new" },
  },
  {
    key: "create_batch",
    title: "Create a batch",
    detail: "Batches are the slots members register against — sessions, attendance and reports all read from them.",
    cta: { label: "Create a batch", href: "/owner/programs" },
  },
  {
    key: "assign_coach",
    title: "Assign a coach to a batch",
    detail: "An unassigned batch has no coach for the register view to show. Pick a coach on the batch card.",
    cta: { label: "Assign a coach", href: "/owner/programs" },
  },
];

export async function getOnboardingChecklist(
  ctx: Pick<ActionCtx, "tenantId">,
): Promise<OnboardingChecklist> {
  const counts = await withTenant(ctx.tenantId, async (tx) => {
    const [{ n: memberCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), isNull(members.deletedAt)));

    const [{ n: batchCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(and(eq(batches.tenantId, ctx.tenantId), isNull(batches.deletedAt)));

    const [{ n: batchWithCoachCount }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, ctx.tenantId),
          isNull(batches.deletedAt),
          isNotNull(batches.coachId),
        ),
      );

    return { memberCount, batchCount, batchWithCoachCount };
  });

  const completion: Record<OnboardingItemKey, boolean> = {
    add_members: counts.memberCount > 0,
    create_batch: counts.batchCount > 0,
    assign_coach: counts.batchWithCoachCount > 0,
  };

  const items: OnboardingItem[] = ITEMS.map((it) => ({
    ...it,
    complete: completion[it.key],
  }));

  const completedCount = items.filter((i) => i.complete).length;

  return {
    items,
    completedCount,
    totalCount: items.length,
  };
}
