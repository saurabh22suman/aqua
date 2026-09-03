import { and, eq, ne, sql, inArray } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { batches } from "@/db/schema/programs";
import type { ActionCtx } from "@/lib/auth/context";
import type { TenantId } from "@/lib/ids";

// Phase R.2 — coach conflict detection. A coach double-booked
// across overlapping sessions warns at assignment time. The
// check runs before the save (per the work guide: "with the
// warning emitted before the save, not after"). The form
// renders the conflict names and lets the user proceed — the
// service is informational, not blocking.
//
// A "conflict" is a same-coach batch on overlapping days AND
// overlapping time ranges, on another live batch (deletedAt is
// null). The batch the user is editing is excluded so we don't
// warn against itself.
//
// Return shape carries the conflicting batch id + name +
// days-of-overlap, for the UI to render. No mutation here.

export type CoachConflict = {
  batchId: string;
  batchName: string;
  daysOverlap: number[];
};

export type CoachConflictCheckResult = {
  conflicts: CoachConflict[];
};

export async function detectCoachConflicts(
  ctx: ActionCtx,
  args: {
    coachId: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    excludeBatchId?: string;
  },
): Promise<CoachConflictCheckResult> {
  if (!args.coachId || args.daysOfWeek.length === 0) {
    return { conflicts: [] };
  }
  return withTenant(ctx.tenantId, async (tx) => {
    // The four rows-touched predicates:
    //   1. tenant scope (RLS would also catch this; the explicit
    //      check keeps the WHERE self-documenting)
    //   2. coach_id match
    //   3. excludeBatchId when supplied
    //   4. deleted_at is null
    // The two overlap predicates:
    //   5. daysOfWeek && unrolled days of week — implemented by
    //      fetching candidate days as int[] and matching via
    //      sql.raw('<daysOfWeek column> && <int[]>')
    //   6. time-window overlap: candidate.start < existing.end and
    //      existing.start < candidate.end, the canonical
    //      interval-overlap predicate
    const daysArray = `ARRAY[${args.daysOfWeek.join(",")}]::int[]`;
    const startTimeLit = `'${args.startTime}'::time`;
    const endTimeLit = `'${args.endTime}'::time`;
    const rows = await tx
      .select({
        id: batches.id,
        name: batches.name,
        daysOfWeek: batches.daysOfWeek,
      })
      .from(batches)
      .where(
        and(
          eq(batches.tenantId, ctx.tenantId as TenantId),
          eq(batches.coachId, args.coachId as never),
          args.excludeBatchId
            ? ne(batches.id, args.excludeBatchId as never)
            : sql`true`,
          sql`${batches.deletedAt} is null`,
          sql.raw(`${batches.daysOfWeek.name} && ${daysArray}`),
          sql.raw(`${batches.startTime.name} < ${endTimeLit} and ${startTimeLit} < ${batches.endTime.name}`),
        ),
      );

    const conflicts: CoachConflict[] = rows.map((r) => ({
      batchId: r.id,
      batchName: r.name,
      daysOverlap: r.daysOfWeek.filter((d) => args.daysOfWeek.includes(d)),
    }));
    return { conflicts };
  });
}

void inArray;
