import type { EnquiryStage } from "@/db/schema/enquiries";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";
import { countEnquiriesByCurrentStage } from "@/lib/services/enquiries";
import { ownerInsightInputSchema, periodWindowUtc } from "@/lib/services/owner-insights-period";
import { insightScope } from "@/lib/services/owner-insights-access";
import type { ActionCtx } from "@/lib/auth/context";

// chart-gallery05 — "Enquiries by current stage".
//
// A SNAPSHOT of a cohort, not a funnel: every enquiry in the cohort
// is counted ONCE, at the stage it sits in right now. An enquiry that
// walked new → contacted → converted contributes to "converted" only.
// A historical step conversion would count it at every stage it
// passed through and the stages would not add up to the cohort —
// that is a different (and misleading) chart.
//
// The cohort is the enquiries CREATED inside the window; the window is
// calendar days in the tenant's timezone.
//
// Visibility is NOT re-implemented here. The scoped aggregate in
// `lib/services/enquiries.ts` owns that rule — tenant, soft delete,
// location scope and the management-only unresolved queue — and this
// read model reuses it, so the chart can never disagree with the
// Enquiries page it links to. It reads COUNTS, never enquiry rows: no
// name, no phone, no identifier, and no full-table read behind a
// dashboard chart.
//
// The six stages come from the database check constraint
// (enquiries_stage_check), so a stage outside the list cannot exist:
// the row count and the cohort total always agree.

export type EnquiryStageInsightRow = {
  stage: EnquiryStage;
  label: string;
  count: number;
  /** Share of the cohort. null when the cohort is empty. */
  share: number | null;
};

export type EnquiryStageInsight = {
  /** Inclusive window start (tenant timezone). */
  from: string;
  /** Exclusive window end (tenant timezone). */
  to: string;
  /** Enquiries created inside the window — each counted exactly once. */
  total: number;
  rows: EnquiryStageInsightRow[];
};

export const ENQUIRY_STAGES = Object.keys(ENQUIRY_STAGE_LABELS) as EnquiryStage[];

// The ONLY way into this read model: parse → gate → read.
export async function getEnquiryStageBreakdown(
  ctx: ActionCtx,
  raw: unknown,
): Promise<EnquiryStageInsight> {
  const input = ownerInsightInputSchema.parse(raw);
  const scope = await insightScope(ctx);
  const { fromUtc, toUtc } = periodWindowUtc(input, scope.timezone);
  const counts = await countEnquiriesByCurrentStage(
    ctx,
    { fromUtc, toUtc },
    { locationId: input.locationId },
  );
  const countByStage = new Map(counts.byStage.map((row) => [row.stage, row.count]));

  const rows: EnquiryStageInsightRow[] = ENQUIRY_STAGES.map((stage) => {
    const count = countByStage.get(stage) ?? 0;
    return {
      stage,
      label: ENQUIRY_STAGE_LABELS[stage],
      count,
      share: counts.total > 0 ? Math.round((count / counts.total) * 100) : null,
    };
  });

  return { from: input.from, to: input.to, total: counts.total, rows };
}
