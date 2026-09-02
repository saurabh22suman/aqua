import { sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import { programs, batches } from "./schema/programs";

// Phase 2.3 — sample-data state query. Used by the tenant detail
// page to decide whether to render the "Remove sample data"
// section. The query is tenant-scoped (within withTenant()) so the
// existing tenant_isolation RLS policy applies — the page never
// reaches a state query for a tenant the operator doesn't already
// have access to.

export type SampleDataState = {
  hasSample: boolean;
  hasReal: boolean;
};

export async function getSampleDataState(
  tenantId: { toString(): string } | string,
): Promise<SampleDataState> {
  // pg's node driver accepts both strings and arbitrary objects that
  // stringify into a uuid; the withTenant signature takes the
  // branded type, but the page is calling through it with a plain
  // string. Cast to the branded type via the unknown escape hatch
  // for tests that don't carry the brand.
  const tid = tenantId as never;

  return withTenant(tid, async (tx) => {
    // hasSample: any non-deleted is_sample=true program or batch.
    // hasReal: any non-deleted, is_sample=false program or batch.
    // Two exists() subqueries — small, indexed by the existing
    // (tenant_id, deleted_at) predicate.
    const programSample = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(programs)
      .where(
        sql`${programs.tenantId} = ${tid}::uuid
            and ${programs.isSample} = true
            and ${programs.deletedAt} is null`,
      );
    const batchSample = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(
        sql`${batches.tenantId} = ${tid}::uuid
            and ${batches.isSample} = true
            and ${batches.deletedAt} is null`,
      );
    const programReal = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(programs)
      .where(
        sql`${programs.tenantId} = ${tid}::uuid
            and ${programs.isSample} = false
            and ${programs.deletedAt} is null`,
      );
    const batchReal = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(batches)
      .where(
        sql`${batches.tenantId} = ${tid}::uuid
            and ${batches.isSample} = false
            and ${batches.deletedAt} is null`,
      );

    const n = (r: { n: number }[] | undefined): number => r?.[0]?.n ?? 0;
    return {
      hasSample: n(programSample as { n: number }[]) > 0 || n(batchSample as { n: number }[]) > 0,
      hasReal: n(programReal as { n: number }[]) > 0 || n(batchReal as { n: number }[]) > 0,
    };
  });
}
